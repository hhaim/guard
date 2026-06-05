package guardsched

import (
	"fmt"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

// ForceMode controls op:force behavior.
type ForceMode string

const (
	ForceModePrefer ForceMode = "prefer"
	ForceModeHard   ForceMode = "hard"
)

// RuleConflict is recorded when force_mode=hard overrides a constraint.
type RuleConflict struct {
	Day      int    `json:"day"`
	Slot     int    `json:"slot"`      // 0-based engine slot
	Shift    int    `json:"shift"`     // calendar_block; -1 whole slot
	Soldier  string `json:"soldier_id"`
	Reason   string `json:"reason"`
	RuleLine string `json:"rule_line,omitempty"`
}

// CustomRule is one parsed expert rule.
type CustomRule struct {
	AllDays      bool
	AllSlots     bool // not/exclude: omit slot → every slot
	Day          int
	SlotIdx      int // 0-based; ignored when AllSlots
	Shift        int // -1 = all shifts / whole slot day
	Op           string
	SoldierIdx   int   // force
	SoldiersNot  []int // not
	PlatoonID    string
	TypeCode     string
	RemapFrom    string
	RemapTo      string
	RemapCount   int
	SourceLine   string
}

// CustomRuleSet is compiled rules for a simulation run.
type CustomRuleSet struct {
	ForceMode  ForceMode
	Rules      []CustomRule
	SoldierIDs []string
	Conflicts  []RuleConflict
	applied    int
}

func (cr *CustomRuleSet) HasAny() bool {
	return cr != nil && len(cr.Rules) > 0
}

func (cr *CustomRuleSet) AppliedCount() int {
	if cr == nil {
		return 0
	}
	return cr.applied
}

func (cr *CustomRuleSet) ConflictsSlice() []RuleConflict {
	if cr == nil {
		return nil
	}
	return cr.Conflicts
}

// CustomRulesDoc is YAML on disk / API.
type CustomRulesDoc struct {
	SchemaVersion int          `yaml:"schema_version"`
	ForceMode     string       `yaml:"force_mode"`
	Rules         []CustomRuleYAML `yaml:"rules"`
}

type CustomRuleYAML struct {
	Day       *int     `yaml:"day"`
	SlotID    any      `yaml:"slot_id"`
	ShiftID   *int     `yaml:"shift_id"`
	Op        string   `yaml:"op"`
	Soldier   string   `yaml:"soldier"`
	Soldiers  []string `yaml:"soldiers"`
	PlatoonID string   `yaml:"platoon_id"`
	Type      string   `yaml:"type"`
	From      string   `yaml:"from"`
	To        string   `yaml:"to"`
	Count     int      `yaml:"count"`
}

func LoadCustomRulesYAML(data []byte, zone *ZoneConfig, soldierIDs []string) (*CustomRuleSet, error) {
	var doc CustomRulesDoc
	if err := yaml.Unmarshal(data, &doc); err != nil {
		return nil, err
	}
	return compileCustomRules(doc.ForceMode, doc.Rules, zone, soldierIDs, "")
}

func ParseRulesText(text string, zone *ZoneConfig, soldierIDs []string, forceHard bool) (*CustomRuleSet, error) {
	forceMode := ForceModePrefer
	if forceHard {
		forceMode = ForceModeHard
	}
	var yrules []CustomRuleYAML
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "force_mode=") {
			if strings.Contains(strings.ToLower(line), "hard") || strings.HasSuffix(line, "=1") {
				forceMode = ForceModeHard
			}
			continue
		}
		yr, err := parseCompactRuleLine(line)
		if err != nil {
			return nil, fmt.Errorf("parse rule %q: %w", line, err)
		}
		yrules = append(yrules, yr)
	}
	return compileCustomRules(string(forceMode), yrules, zone, soldierIDs, text)
}

func compactLineHasOp(parts []string, op string) bool {
	for _, p := range parts {
		if p == op {
			return true
		}
	}
	return false
}

func parseCompactRuleLine(line string) (CustomRuleYAML, error) {
	var yr CustomRuleYAML
	parts := strings.Fields(line)
	kv := map[string]string{}
	for _, p := range parts {
		i := strings.Index(p, ":")
		if i <= 0 {
			continue
		}
		kv[p[:i]] = p[i+1:]
	}
	if v, ok := kv["day"]; ok {
		d, err := strconv.Atoi(v)
		if err != nil {
			return yr, fmt.Errorf("day")
		}
		yr.Day = &d
	}
	if v, ok := kv["slot"]; ok {
		yr.SlotID = v
	}
	if v, ok := kv["shift"]; ok {
		s, err := strconv.Atoi(v)
		if err != nil {
			return yr, fmt.Errorf("shift")
		}
		yr.ShiftID = &s
	}
	switch {
	case kv["force"] != "":
		yr.Op = "force"
		yr.Soldier = kv["force"]
	case kv["not"] != "":
		yr.Op = "not"
		for _, id := range strings.Split(kv["not"], ",") {
			id = strings.TrimSpace(id)
			if id != "" {
				yr.Soldiers = append(yr.Soldiers, id)
			}
		}
	case kv["exclude"] != "":
		yr.Op = "exclude"
		for _, id := range strings.Split(kv["exclude"], ",") {
			id = strings.TrimSpace(id)
			if id != "" {
				yr.Soldiers = append(yr.Soldiers, id)
			}
		}
	case kv["pin"] != "":
		yr.Op = "pin"
		yr.PlatoonID = kv["pin"]
	case compactLineHasOp(parts, "type_remap") || kv["type_remap"] != "":
		yr.Op = "type_remap"
		rem := kv["type_remap"]
		if rem == "" {
			for _, p := range parts {
				if strings.Contains(p, ">") {
					rem = p
					break
				}
			}
		}
		if rem == "" {
			return yr, fmt.Errorf("type_remap")
		}
		// G>H:2
		main, cnt, _ := strings.Cut(rem, ":")
		from, to, ok := strings.Cut(main, ">")
		if !ok {
			return yr, fmt.Errorf("type_remap format")
		}
		yr.From = strings.TrimSpace(from)
		yr.To = strings.TrimSpace(to)
		if cnt != "" {
			c, err := strconv.Atoi(cnt)
			if err != nil {
				return yr, err
			}
			yr.Count = c
		}
	default:
		if kv["force_type"] != "" {
			yr.Op = "force_type"
			yr.Type = kv["force_type"]
		} else {
			return yr, fmt.Errorf("unknown op")
		}
	}
	return yr, nil
}

func compileCustomRules(forceMode string, yrules []CustomRuleYAML, zone *ZoneConfig, soldierIDs []string, _ string) (*CustomRuleSet, error) {
	if len(yrules) == 0 {
		return nil, nil
	}
	fm := ForceModePrefer
	if strings.EqualFold(strings.TrimSpace(forceMode), "hard") {
		fm = ForceModeHard
	}
	cr := &CustomRuleSet{ForceMode: fm, SoldierIDs: soldierIDs}
	for _, yr := range yrules {
		r, err := compileOneRule(yr, zone, soldierIDs)
		if err != nil {
			return nil, err
		}
		cr.Rules = append(cr.Rules, r)
	}
	return cr, nil
}

func compileOneRule(yr CustomRuleYAML, zone *ZoneConfig, soldierIDs []string) (CustomRule, error) {
	var r CustomRule
	r.Op = strings.TrimSpace(strings.ToLower(yr.Op))
	if r.Op == "" {
		return r, fmt.Errorf("missing op")
	}
	if yr.Day == nil {
		r.AllDays = true
	} else {
		r.Day = *yr.Day
	}
	if yr.ShiftID != nil {
		r.Shift = *yr.ShiftID
	} else {
		r.Shift = -1
	}

	switch r.Op {
	case "exclude":
		if yr.SlotID != nil {
			return r, fmt.Errorf("exclude does not allow slot; use not")
		}
		if yr.ShiftID != nil {
			return r, fmt.Errorf("exclude does not allow shift; use not with shift")
		}
		r.Op = "not"
		r.AllSlots = true
		for _, id := range yr.Soldiers {
			idx, err := soldierIndex(soldierIDs, id)
			if err != nil {
				return r, err
			}
			r.SoldiersNot = append(r.SoldiersNot, idx)
		}
		if len(r.SoldiersNot) == 0 {
			return r, fmt.Errorf("exclude requires at least one soldier")
		}
	case "not":
		if yr.SlotID == nil {
			r.AllSlots = true
		} else {
			sidx, err := ResolveSlotID(zone, yr.SlotID)
			if err != nil {
				return r, err
			}
			r.SlotIdx = sidx
		}
		for _, id := range yr.Soldiers {
			idx, err := soldierIndex(soldierIDs, id)
			if err != nil {
				return r, err
			}
			r.SoldiersNot = append(r.SoldiersNot, idx)
		}
		if len(r.SoldiersNot) == 0 {
			return r, fmt.Errorf("not requires at least one soldier")
		}
	case "force":
		sidx, err := resolveRequiredSlot(zone, yr.SlotID)
		if err != nil {
			return r, err
		}
		r.SlotIdx = sidx
		r.SoldierIdx, err = soldierIndex(soldierIDs, yr.Soldier)
		if err != nil {
			return r, err
		}
	case "pin":
		sidx, err := resolveRequiredSlot(zone, yr.SlotID)
		if err != nil {
			return r, err
		}
		r.SlotIdx = sidx
		pat := zone.Slots[sidx].Pattern
		if pat != "full_day_team" {
			return r, fmt.Errorf("pin only allowed on full_day_team (slot %d)", sidx+1)
		}
		r.PlatoonID = strings.TrimSpace(yr.PlatoonID)
	case "force_type":
		sidx, err := resolveRequiredSlot(zone, yr.SlotID)
		if err != nil {
			return r, err
		}
		r.SlotIdx = sidx
		pat := zone.Slots[sidx].Pattern
		if pat == "full_day_team" {
			return r, fmt.Errorf("force_type not allowed on full_day_team slot %d; use type_remap", sidx+1)
		}
		r.TypeCode = strings.TrimSpace(strings.ToUpper(yr.Type))
		if r.TypeCode == "" {
			return r, fmt.Errorf("force_type requires type")
		}
	case "type_remap":
		sidx, err := resolveRequiredSlot(zone, yr.SlotID)
		if err != nil {
			return r, err
		}
		r.SlotIdx = sidx
		pat := zone.Slots[sidx].Pattern
		if pat != "full_day_team" {
			return r, fmt.Errorf("type_remap only allowed on full_day_team (slot %d)", sidx+1)
		}
		r.RemapFrom = strings.TrimSpace(strings.ToUpper(yr.From))
		r.RemapTo = strings.TrimSpace(strings.ToUpper(yr.To))
		r.RemapCount = yr.Count
		if r.RemapCount < 1 {
			return r, fmt.Errorf("type_remap count must be >= 1")
		}
	default:
		return r, fmt.Errorf("unknown op %q", r.Op)
	}
	return r, nil
}

func resolveRequiredSlot(zone *ZoneConfig, slotID any) (int, error) {
	if slotID == nil {
		return 0, fmt.Errorf("slot is required")
	}
	return ResolveSlotID(zone, slotID)
}

// ResolveSlotID maps 1-based int or slot name to 0-based index.
func ResolveSlotID(zone *ZoneConfig, slotID any) (int, error) {
	if zone == nil {
		return 0, fmt.Errorf("nil zone")
	}
	switch v := slotID.(type) {
	case int:
		return slotID1To0(v, len(zone.Slots))
	case int64:
		return slotID1To0(int(v), len(zone.Slots))
	case float64:
		return slotID1To0(int(v), len(zone.Slots))
	case string:
		s := strings.TrimSpace(v)
		if n, err := strconv.Atoi(s); err == nil {
			return slotID1To0(n, len(zone.Slots))
		}
		for i, sl := range zone.Slots {
			if strings.EqualFold(sl.DisplayName, s) {
				return i, nil
			}
		}
		return 0, fmt.Errorf("unknown slot name %q", s)
	default:
		return 0, fmt.Errorf("invalid slot_id")
	}
}

func slotID1To0(oneBased, n int) (int, error) {
	if oneBased < 1 || oneBased > n {
		return 0, fmt.Errorf("slot_id %d out of range 1..%d", oneBased, n)
	}
	return oneBased - 1, nil
}

func soldierIndex(ids []string, soldierID string) (int, error) {
	soldierID = strings.TrimSpace(soldierID)
	for i, id := range ids {
		if id == soldierID {
			return i, nil
		}
	}
	return 0, fmt.Errorf("unknown soldier %q", soldierID)
}

func soldierIDAt(ids []string, idx int) string {
	if idx >= 0 && idx < len(ids) {
		return ids[idx]
	}
	return fmt.Sprintf("s%d", idx)
}

func (cr *CustomRuleSet) rulesFor(day, sidx, shift int) []CustomRule {
	if cr == nil {
		return nil
	}
	var out []CustomRule
	for _, r := range cr.Rules {
		if !r.AllSlots && r.SlotIdx != sidx {
			continue
		}
		if !r.AllDays && r.Day != day {
			continue
		}
		if r.Shift >= 0 && r.Shift != shift {
			continue
		}
		out = append(out, r)
	}
	return out
}

func (cr *CustomRuleSet) soldierExcluded(day, sidx, shift, soldierIdx int) bool {
	if cr == nil {
		return false
	}
	for _, r := range cr.rulesFor(day, sidx, shift) {
		if r.Op != "not" {
			continue
		}
		for _, idx := range r.SoldiersNot {
			if idx == soldierIdx {
				return true
			}
		}
	}
	return false
}

func (cr *CustomRuleSet) lastRule(day, sidx, shift int, op string) *CustomRule {
	rs := cr.rulesFor(day, sidx, shift)
	var last *CustomRule
	for i := range rs {
		if rs[i].Op == op {
			last = &rs[i]
		}
	}
	return last
}

// FilterPool applies not and force_type rules.
func (cr *CustomRuleSet) FilterPool(pool []*Soldier, day, sidx, shift int, typeCodes []string) []*Soldier {
	if cr == nil || len(pool) == 0 {
		return pool
	}
	rs := cr.rulesFor(day, sidx, shift)
	if len(rs) == 0 {
		return pool
	}
	excl := map[int]bool{}
	var wantType string
	for _, r := range rs {
		switch r.Op {
		case "not":
			for _, idx := range r.SoldiersNot {
				excl[idx] = true
			}
		case "force_type":
			wantType = r.TypeCode
		}
	}
	var out []*Soldier
	for _, s := range pool {
		if excl[s.Idx] {
			continue
		}
		if wantType != "" && typeCodes != nil && s.Idx < len(typeCodes) {
			if strings.TrimSpace(typeCodes[s.Idx]) != wantType {
				continue
			}
		}
		out = append(out, s)
	}
	return out
}

// PickSoldier applies force (prefer/hard) then normal pick.
func (cr *CustomRuleSet) PickSoldier(
	pool []*Soldier,
	all []*Soldier,
	day, sidx, shift int,
	inPool func(*Soldier) bool,
	pickNormal func([]*Soldier) *Soldier,
) *Soldier {
	if cr == nil {
		return pickNormal(pool)
	}
	fr := cr.lastRule(day, sidx, shift, "force")
	if fr == nil {
		return pickNormal(pool)
	}
	target := fr.SoldierIdx
	var chosen *Soldier
	for _, s := range all {
		if s.Idx == target {
			chosen = s
			break
		}
	}
	if chosen == nil {
		return pickNormal(pool)
	}
	if cr.soldierExcluded(day, sidx, shift, target) {
		if cr.ForceMode == ForceModeHard {
			cr.Conflicts = append(cr.Conflicts, RuleConflict{
				Day: day, Slot: sidx, Shift: shift,
				Soldier: soldierIDAt(cr.SoldierIDs, target),
				Reason:  "not_blocks_force",
			})
		}
		return pickNormal(pool)
	}
	cr.applied++
	in := inPool(chosen)
	if in {
		return chosen
	}
	if cr.ForceMode == ForceModeHard {
		cr.Conflicts = append(cr.Conflicts, RuleConflict{
			Day: day, Slot: sidx, Shift: shift,
			Soldier: soldierIDAt(cr.SoldierIDs, target),
			Reason:  "force_hard_override",
		})
		return chosen
	}
	return pickNormal(pool)
}

// PinPlatoon returns platoon_id override for full_day_team slot/day.
func (cr *CustomRuleSet) PinPlatoon(day, sidx int) (string, bool) {
	if cr == nil {
		return "", false
	}
	if pr := cr.lastRule(day, sidx, -1, "pin"); pr != nil {
		cr.applied++
		return pr.PlatoonID, true
	}
	return "", false
}

func pickSoldiersNWithRules(
	n int,
	poolBase func(assigned []*Soldier) []*Soldier,
	locI, timeMid int,
	deltasLoc, deltasTime [][]float64,
	deltasG []float64,
	r *PyRandom,
	bandRelative float64,
	balanceTotalHours bool,
	totalHoursSlack float64,
	rotPf prefixFn,
	cr *CustomRuleSet,
	day, sidx, shift int,
	all []*Soldier,
	typeCodes []string,
	inPool func(*Soldier) bool,
	rotating bool,
) ([]*Soldier, error) {
	if cr == nil {
		if rotating {
			return pickSoldiersForRotatingSlot(n, poolBase, locI, timeMid, deltasLoc, deltasTime, deltasG, r, bandRelative, balanceTotalHours, totalHoursSlack, rotPf)
		}
		return pickSoldiersForSlot(n, poolBase, locI, timeMid, deltasLoc, deltasTime, deltasG, r, bandRelative, balanceTotalHours, totalHoursSlack, rotPf)
	}
	var assigned []*Soldier
	pickOne := pickSoldier
	if rotating {
		pickOne = func(pool []*Soldier, li, tj int, dl, dt [][]float64, dg []float64, rng *PyRandom, br float64, bth bool, ths float64, pf prefixFn) *Soldier {
			return pickRotatingSoldier(pool, li, tj, dl, dt, dg, rng, br, bth, ths, pf)
		}
	}
	for i := 0; i < n; i++ {
		pool := poolBase(assigned)
		pool = cr.FilterPool(pool, day, sidx, shift, typeCodes)
		if len(pool) == 0 && cr.lastRule(day, sidx, shift, "force") == nil {
			return nil, fmt.Errorf("need %d soldiers, have %d available", n, i)
		}
		chosen := cr.PickSoldier(pool, all, day, sidx, shift, inPool, func(p []*Soldier) *Soldier {
			if len(p) == 0 {
				return nil
			}
			return pickOne(p, locI, timeMid, deltasLoc, deltasTime, deltasG, r, bandRelative, balanceTotalHours, totalHoursSlack, rotPf)
		})
		if chosen == nil {
			return nil, fmt.Errorf("need %d soldiers, have %d available", n, i)
		}
		assigned = append(assigned, chosen)
	}
	return assigned, nil
}

// ApplyTypeRemap copies team spec quotas with expert remap applied.
func (cr *CustomRuleSet) ApplyTypeRemap(day, sidx int, cfg FullDayTeamSpec) FullDayTeamSpec {
	if cr == nil {
		return cfg
	}
	rs := cr.rulesFor(day, sidx, -1)
	out := cfg
	out.TypeQuotas = map[string]int{}
	for k, v := range cfg.TypeQuotas {
		out.TypeQuotas[k] = v
	}
	for _, r := range rs {
		if r.Op != "type_remap" {
			continue
		}
		cr.applied++
		from, to, n := r.RemapFrom, r.RemapTo, r.RemapCount
		if out.TypeQuotas[from] < n {
			n = out.TypeQuotas[from]
		}
		out.TypeQuotas[from] -= n
		if out.TypeQuotas[from] <= 0 {
			delete(out.TypeQuotas, from)
		}
		out.TypeQuotas[to] += n
	}
	return out
}

// ExpertRulesDoc is JSON stored at cfg key expert_rules (Plan UI).
type ExpertRulesDoc struct {
	SchemaVersion int               `json:"schema_version"`
	Force         bool              `json:"force"`
	RulesText     string            `json:"rules_text"`
	ActiveGroups  []string          `json:"active_groups"`
	Groups        map[string]string `json:"groups"`
}

// MergeExpertRulesText picks rules text: request override, then active groups, then stored rules_text.
func MergeExpertRulesText(doc *ExpertRulesDoc, overrideText string, overrideActive []string) string {
	if t := strings.TrimSpace(overrideText); t != "" {
		return t
	}
	active := overrideActive
	if len(active) == 0 && doc != nil {
		active = doc.ActiveGroups
	}
	if doc != nil && len(active) > 0 && doc.Groups != nil {
		var parts []string
		for _, g := range active {
			if t, ok := doc.Groups[g]; ok && strings.TrimSpace(t) != "" {
				parts = append(parts, strings.TrimSpace(t))
			}
		}
		if len(parts) > 0 {
			return strings.Join(parts, "\n")
		}
	}
	if doc != nil {
		return strings.TrimSpace(doc.RulesText)
	}
	return ""
}

// CustomRulesMeta returns plan meta fields for a rule set (nil if empty).
func CustomRulesMeta(cr *CustomRuleSet) map[string]any {
	if cr == nil || !cr.HasAny() {
		return nil
	}
	out := map[string]any{
		"custom_rules_applied": cr.AppliedCount(),
		"force_mode":           string(cr.ForceMode),
	}
	if conflicts := cr.ConflictsSlice(); len(conflicts) > 0 {
		out["rule_conflicts"] = conflicts
	}
	return out
}

// NormalizedAssignment is a stable tuple for golden regression tests.
type NormalizedAssignment struct {
	Day     int    `json:"day"`
	Slot    int    `json:"slot"`
	Shift   int    `json:"shift"`
	Soldier int    `json:"soldier"`
	Kind    string `json:"kind"`
}

// NormalizeAssignments exports comparable assignment tuples sorted for golden tests.
func NormalizeAssignments(recs []*AssignmentRecord) []NormalizedAssignment {
	var out []NormalizedAssignment
	for _, a := range recs {
		if a == nil {
			continue
		}
		out = append(out, NormalizedAssignment{
			Day: a.Day, Slot: a.Slot, Shift: a.CalendarBlock,
			Soldier: a.SoldierIdx, Kind: a.Kind,
		})
	}
	sortNormalizedAssignments(out)
	return out
}

func sortNormalizedAssignments(out []NormalizedAssignment) {
	for i := 0; i < len(out); i++ {
		for j := i + 1; j < len(out); j++ {
			if normLess(out[j], out[i]) {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
}

func normLess(a, b NormalizedAssignment) bool {
	if a.Day != b.Day {
		return a.Day < b.Day
	}
	if a.Slot != b.Slot {
		return a.Slot < b.Slot
	}
	if a.Shift != b.Shift {
		return a.Shift < b.Shift
	}
	if a.Kind != b.Kind {
		return a.Kind < b.Kind
	}
	return a.Soldier < b.Soldier
}

package guardsched

import (
	"fmt"
	"math"
	"strings"

	"gopkg.in/yaml.v3"
)

// FullDaySpec holds parsed full_day slots_types config.
type FullDaySpec struct {
	StartH, EndH int
	RestAfterH   float64
	WeightMult   float64
	Headcount    int // soldiers per day for each slot row of this type (default 1)
}

// FullDayTeamSpec holds parsed full_day_team slots_types config.
type FullDayTeamSpec struct {
	StartH, EndH int
	RestAfterH   float64
	WeightMult   float64
	Headcount    int
	TypeQuotas   map[string]int
}

// WindowSpec is one window in windowed_slots.
type WindowSpec struct {
	Name       string
	H0, H1Excl int
	WeightMult float64
}

// ZoneLocation is one row from YAML `zone_loc` (schema v2).
type ZoneLocation struct {
	ID       string
	Name     string // short label (YAML `name`)
	FullName string // optional detail (YAML `full_name`)
	Weight   float64
	TypeID   string // slots_types id for this location
}

// ZoneTimeBand is one row from YAML `time_zones`.
type ZoneTimeBand struct {
	ID       string
	Name     string
	Weight   float64
	FromHour int
	ToHour   int
}

// ZoneSlot is one concurrent slot row from YAML `slots` (order = slot index).
type ZoneSlot struct {
	LocationIndex    int    // index into Locations
	DisplayName      string // slot label: full_name or name from YAML
	Pattern          string // rotating | full_day | full_day_team | windowed_slots
	SoldiersRequired int    // per-slot demand for rotating only (default 1); full_day/windowed use type headcount
}

// ZoneConfig is schema v2 YAML (mixed patterns).
type ZoneConfig struct {
	Locations         []ZoneLocation
	TimeBands         []ZoneTimeBand
	Slots             []ZoneSlot
	ShiftHours        float64
	SchemaVersion     int
	FullDaySpecs      map[string]FullDaySpec
	FullDayTeamSpecs  map[string]FullDayTeamSpec
	WindowedSpecs      map[string][]WindowSpec
	WindowedRestHours  map[string]float64
	WindowedHeadcount  map[string]int
	// DisabledWeekdays[typeID] = weekday indices 0=Sunday..6=Saturday when slot type is off.
	DisabledWeekdays map[string][]int
}

// ToZone builds the minimal Zone used by timeCategoryForHour and rotating sim.
func (z *ZoneConfig) ToZone() *Zone {
	lw := make([]float64, len(z.Locations))
	for i, loc := range z.Locations {
		lw[i] = loc.Weight
	}
	tw := make([]float64, len(z.TimeBands))
	tf := make([]int, len(z.TimeBands))
	tt := make([]int, len(z.TimeBands))
	for i, tb := range z.TimeBands {
		tw[i] = tb.Weight
		tf[i] = tb.FromHour
		tt[i] = tb.ToHour
	}
	sli := make([]int, len(z.Slots))
	sp := make([]string, len(z.Slots))
	for i, s := range z.Slots {
		sli[i] = s.LocationIndex
		sp[i] = s.Pattern
	}
	return &Zone{
		ShiftHours:      z.ShiftHours,
		LocWeights:      lw,
		TimeWeights:     tw,
		TimeFrom:        tf,
		TimeTo:          tt,
		SlotLocationIdx: sli,
		SlotPatterns:    sp,
	}
}

// SlotsPerBlock returns concurrent slot count.
func (z *ZoneConfig) SlotsPerBlock() int { return len(z.Slots) }

// LoadZoneConfigYAML parses schema v2 zones document from bytes (DB or file).
func LoadZoneConfigYAML(raw []byte, slotsPerBlock int, shiftHoursOverride *float64) (*ZoneConfig, error) {
	var data map[string]any
	if err := yaml.Unmarshal(raw, &data); err != nil {
		return nil, err
	}
	if int(intFromAny(data["schema_version"], 1)) < 2 || data["slots_types"] == nil {
		return nil, fmt.Errorf("zones: need schema_version>=2 and slots_types")
	}
	stypes, ok := data["slots_types"].([]any)
	if !ok || len(stypes) == 0 {
		return nil, fmt.Errorf("zones: slots_types must be non-empty list")
	}
	typePattern := map[string]string{}
	fullDay := map[string]FullDaySpec{}
	fullDayTeam := map[string]FullDayTeamSpec{}
	disabledWD := map[string][]int{}
	windowed := map[string][]WindowSpec{}
	winRest := map[string]float64{}
	winHeadcount := map[string]int{}
	for _, row := range stypes {
		m, ok := row.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("slots_types: entry must be mapping")
		}
		tid := strings.TrimSpace(fmt.Sprint(m["id"]))
		pat := strings.TrimSpace(fmt.Sprint(m["pattern"]))
		if tid == "" {
			return nil, fmt.Errorf("slots_types: missing id")
		}
		if dw, ok := m["disabled_weekdays"]; ok {
			wds, err := ParseDisabledWeekdays(dw)
			if err != nil {
				return nil, fmt.Errorf("slots_types %q: %w", tid, err)
			}
			if len(wds) > 0 {
				disabledWD[tid] = wds
			}
		}
		switch pat {
		case "rotating":
			typePattern[tid] = pat
		case "full_day":
			typePattern[tid] = pat
			fd, err := parseFullDaySpecFromConfig(m["config"], tid, "full_day", true)
			if err != nil {
				return nil, err
			}
			fullDay[tid] = fd
		case "full_day_team":
			typePattern[tid] = pat
			cfg, _ := m["config"].(map[string]any)
			if cfg == nil {
				return nil, fmt.Errorf("full_day_team %q: missing config", tid)
			}
			fd, err := parseFullDaySpecFromConfig(cfg, tid, "full_day_team", false)
			if err != nil {
				return nil, err
			}
			hc := int(intFromAny(cfg["headcount"], 0))
			if hc < 1 {
				return nil, fmt.Errorf("full_day_team %q: headcount must be >= 1", tid)
			}
			quotas, err := parseTypeQuotas(cfg["type_quotas"])
			if err != nil {
				return nil, fmt.Errorf("full_day_team %q: %w", tid, err)
			}
			sumQ := 0
			for _, q := range quotas {
				sumQ += q
			}
			if sumQ > hc {
				return nil, fmt.Errorf("full_day_team %q: sum(type_quotas)=%d exceeds headcount=%d", tid, sumQ, hc)
			}
			fullDayTeam[tid] = FullDayTeamSpec{
				StartH: fd.StartH, EndH: fd.EndH, RestAfterH: fd.RestAfterH, WeightMult: fd.WeightMult,
				Headcount: hc, TypeQuotas: quotas,
			}
		case "windowed_slots":
			typePattern[tid] = pat
			cfg, _ := m["config"].(map[string]any)
			if cfg == nil {
				return nil, fmt.Errorf("windowed_slots %q: missing config", tid)
			}
			slotsW, _ := cfg["slots"].([]any)
			if len(slotsW) == 0 {
				return nil, fmt.Errorf("windowed_slots %q: config.slots required", tid)
			}
			var wl []WindowSpec
			for _, sw := range slotsW {
				sm, ok := sw.(map[string]any)
				if !ok {
					return nil, fmt.Errorf("windowed_slots %q: bad slots entry", tid)
				}
				h0, h1x, err := windowHalfOpenHours(fmt.Sprint(sm["start"]), fmt.Sprint(sm["end"]))
				if err != nil {
					return nil, fmt.Errorf("windowed_slots %q: %w", tid, err)
				}
				wm := 1.0
				if v, ok := sm["weight_multiplier"]; ok {
					wm = floatFromAny(v)
				} else if v, ok := sm["weight_mult"]; ok {
					wm = floatFromAny(v)
				}
				name := strings.TrimSpace(fmt.Sprint(sm["name"]))
				wl = append(wl, WindowSpec{Name: name, H0: h0, H1Excl: h1x, WeightMult: wm})
			}
			windowed[tid] = wl
			hc := int(intFromAny(cfg["headcount"], 1))
			if hc < 1 {
				return nil, fmt.Errorf("windowed_slots %q: headcount must be >= 1", tid)
			}
			winHeadcount[tid] = hc
			rh := 6.0
			if v, ok := m["rest_after_hours"]; ok {
				rh = floatFromAny(v)
			} else if v, ok := m["rest_after"]; ok {
				rh = floatFromAny(v)
			}
			winRest[tid] = rh
		default:
			return nil, fmt.Errorf("slots_types %q: unknown pattern %q", tid, pat)
		}
	}

	locsRaw := zoneLocYAMLList(data)
	locs, ok := locsRaw.([]any)
	if !ok || len(locs) == 0 {
		return nil, fmt.Errorf("zones: zone_loc list required")
	}
	var locations []ZoneLocation
	locIDToIdx := map[string]int{}
	for i, row := range locs {
		m, ok := row.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("zone_loc[%d]: expected mapping", i)
		}
		zid := strings.TrimSpace(fmt.Sprint(m["id"]))
		name := strings.TrimSpace(fmt.Sprint(m["name"]))
		if name == "" {
			name = zid
		}
		fullName := strings.TrimSpace(fmt.Sprint(m["full_name"]))
		if fullName == "" {
			fullName = name
		}
		lt := strings.TrimSpace(fmt.Sprint(m["type"]))
		if zid == "" || lt == "" {
			return nil, fmt.Errorf("zone_loc[%d]: id and type required", i)
		}
		if _, ok := typePattern[lt]; !ok {
			return nil, fmt.Errorf("zone_loc[%d]: unknown type %q", i, lt)
		}
		w := floatFromAny(m["weight"])
		locations = append(locations, ZoneLocation{ID: zid, Name: name, FullName: fullName, Weight: w, TypeID: lt})
		locIDToIdx[zid] = i
	}

	slotLoc, slotNames, slotSoldiersReq, err := parseSlotLocationIndices(data, slotsPerBlock, locIDToIdx)
	if err != nil {
		return nil, err
	}
	slots := make([]ZoneSlot, len(slotLoc))
	for sidx, li := range slotLoc {
		ltid := locations[li].TypeID
		nReq := slotSoldiersReq[sidx]
		if nReq < 1 {
			nReq = 1
		}
		slots[sidx] = ZoneSlot{
			LocationIndex:    li,
			DisplayName:      slotNames[sidx],
			Pattern:          typePattern[ltid],
			SoldiersRequired: nReq,
		}
	}

	shYaml := 3.0
	if v, ok := data["shift_hours"]; ok {
		shYaml = floatFromAny(v)
	}
	if shYaml <= 0 {
		shYaml = 3.0
	}
	shEff := shYaml
	if shiftHoursOverride != nil {
		shEff = *shiftHoursOverride
	}
	if _, err := CalendarBlocksPerDaySafe(shEff); err != nil {
		return nil, err
	}

	tzs, ok := data["time_zones"].([]any)
	if !ok || len(tzs) == 0 {
		return nil, fmt.Errorf("time_zones required")
	}
	defFrom := []int{0, 6, 12}
	defTo := []int{5, 11, 23}
	var timeBands []ZoneTimeBand
	for i, row := range tzs {
		m, ok := row.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("time_zones[%d]: mapping", i)
		}
		zid := strings.TrimSpace(fmt.Sprint(m["id"]))
		name := strings.TrimSpace(fmt.Sprint(m["name"]))
		if name == "" {
			name = zid
		}
		if zid == "" {
			return nil, fmt.Errorf("time_zones[%d]: missing id", i)
		}
		di := i
		if di >= len(defFrom) {
			di = len(defFrom) - 1
		}
		timeBands = append(timeBands, ZoneTimeBand{
			ID:       zid,
			Name:     name,
			Weight:   floatFromAny(m["weight"]),
			FromHour: int(intFromAny(m["from_hour"], defFrom[di])),
			ToHour:   int(intFromAny(m["to_hour"], defTo[di])),
		})
	}

	zc := &ZoneConfig{
		Locations:         locations,
		TimeBands:         timeBands,
		Slots:             slots,
		ShiftHours:        shEff,
		SchemaVersion:     int(intFromAny(data["schema_version"], 2)),
		FullDaySpecs:      fullDay,
		FullDayTeamSpecs:  fullDayTeam,
		WindowedSpecs:      windowed,
		WindowedRestHours:  winRest,
		WindowedHeadcount:  winHeadcount,
		DisabledWeekdays:  disabledWD,
	}
	return zc, nil
}

func parseFullDaySpecFromConfig(cfgAny any, tid, kind string, requireHeadcount bool) (FullDaySpec, error) {
	cfg, _ := cfgAny.(map[string]any)
	if cfg == nil {
		return FullDaySpec{}, fmt.Errorf("%s %q: missing config", kind, tid)
	}
	sh0, sh1, err := parseInclusiveFullDayHours(fmt.Sprint(cfg["start"]), fmt.Sprint(cfg["end"]))
	if err != nil {
		return FullDaySpec{}, fmt.Errorf("%s %q: %w", kind, tid, err)
	}
	ra := 6.0
	if v, ok := cfg["rest_after_hours"]; ok {
		ra = floatFromAny(v)
	} else if v, ok := cfg["rest_after"]; ok {
		ra = floatFromAny(v)
	}
	if ra < 0 {
		return FullDaySpec{}, fmt.Errorf("%s %q: rest_after_hours must be >= 0", kind, tid)
	}
	wm := 1.0
	if v, ok := cfg["weight_multiplier"]; ok {
		wm = floatFromAny(v)
	} else if v, ok := cfg["weight_mult"]; ok {
		wm = floatFromAny(v)
	} else if v, ok := cfg["w_mult"]; ok {
		wm = floatFromAny(v)
	}
	hc := 1
	if requireHeadcount {
		hc = int(intFromAny(cfg["headcount"], 1))
		if hc < 1 {
			return FullDaySpec{}, fmt.Errorf("%s %q: headcount must be >= 1", kind, tid)
		}
	}
	return FullDaySpec{StartH: sh0, EndH: sh1, RestAfterH: ra, WeightMult: wm, Headcount: hc}, nil
}

func parseTypeQuotas(raw any) (map[string]int, error) {
	if raw == nil {
		return nil, nil
	}
	m, ok := raw.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("type_quotas must be a mapping")
	}
	out := make(map[string]int, len(m))
	for k, v := range m {
		code := strings.TrimSpace(k)
		if code == "" || code == "*" {
			return nil, fmt.Errorf("type_quotas: invalid key %q", k)
		}
		q := int(intFromAny(v, 0))
		if q < 1 {
			return nil, fmt.Errorf("type_quotas[%q]: quota must be >= 1", code)
		}
		out[code] = q
	}
	return out, nil
}

// IsSlotTypeDisabledOnWeekday reports whether typeID is off on weekday (0=Sunday..6=Saturday).
func (z *ZoneConfig) IsSlotTypeDisabledOnWeekday(typeID string, weekday int) bool {
	wds, ok := z.DisabledWeekdays[typeID]
	if !ok {
		return false
	}
	for _, w := range wds {
		if w == weekday {
			return true
		}
	}
	return false
}

// zoneLocYAMLList returns zone_loc entries, with legacy keys locations / location_zones.
func zoneLocYAMLList(data map[string]any) any {
	if v, ok := data["zone_loc"]; ok {
		return v
	}
	if v, ok := data["locations"]; ok {
		return v
	}
	return data["location_zones"]
}

func parseSlotLocationIndices(data map[string]any, slotsPerBlock int, locIDToIdx map[string]int) ([]int, []string, []int, error) {
	raw := data["slots"]
	if raw == nil {
		raw = data["slot_locations"]
	}
	rows, ok := raw.([]any)
	if !ok {
		return nil, nil, nil, fmt.Errorf("slots: must be a list")
	}
	if len(rows) != slotsPerBlock {
		return nil, nil, nil, fmt.Errorf("slots: length %d != slotsPerBlock %d", len(rows), slotsPerBlock)
	}
	out := make([]int, slotsPerBlock)
	names := make([]string, slotsPerBlock)
	nReq := make([]int, slotsPerBlock)
	for i, entry := range rows {
		var lid, disp string
		req := 1
		switch e := entry.(type) {
		case string:
			lid = strings.TrimSpace(e)
		case map[string]any:
			lid = yamlStrField(e, "location_id", "id")
			disp = yamlStrField(e, "full_name", "name")
			if v, ok := e["soldiers_required"]; ok {
				req = int(intFromAny(v, 1))
				if req < 1 {
					return nil, nil, nil, fmt.Errorf("slots[%d]: soldiers_required must be >= 1", i)
				}
			}
		default:
			return nil, nil, nil, fmt.Errorf("slots[%d]: string or mapping", i)
		}
		if lid == "" {
			return nil, nil, nil, fmt.Errorf("slots[%d]: missing location_id", i)
		}
		li, ok := locIDToIdx[lid]
		if !ok {
			return nil, nil, nil, fmt.Errorf("slots[%d]: unknown location_id %q", i, lid)
		}
		out[i] = li
		names[i] = disp
		nReq[i] = req
	}
	return out, names, nReq, nil
}

// yamlStrField returns the first non-empty string field from a YAML mapping (ignores null / "<nil>").
func yamlStrField(m map[string]any, keys ...string) string {
	for _, k := range keys {
		v, ok := m[k]
		if !ok || v == nil {
			continue
		}
		s := strings.TrimSpace(fmt.Sprint(v))
		if s != "" && s != "<nil>" {
			return s
		}
	}
	return ""
}

func parseHHMMClock(s string) (int, error) {
	s = strings.TrimSpace(s)
	parts := strings.Split(s, ":")
	if len(parts) < 1 {
		return 0, fmt.Errorf("bad time %q", s)
	}
	var h, m int
	fmt.Sscanf(parts[0], "%d", &h)
	if len(parts) > 1 {
		fmt.Sscanf(parts[1], "%d", &m)
	}
	if m != 0 {
		return 0, fmt.Errorf("time %q must be whole hours", s)
	}
	if h == 24 {
		return 24, nil
	}
	if h < 0 || h > 23 {
		return 0, fmt.Errorf("hour out of range in %q", s)
	}
	return h, nil
}

func parseInclusiveFullDayHours(startS, endS string) (int, int, error) {
	lo, err := parseHHMMClock(startS)
	if err != nil {
		return 0, 0, err
	}
	hi, err := parseHHMMClock(endS)
	if err != nil {
		return 0, 0, err
	}
	if lo == 24 || hi == 24 {
		return 0, 0, fmt.Errorf("full_day start/end must be 0..23")
	}
	return lo, hi, nil
}

func windowHalfOpenHours(startS, endS string) (int, int, error) {
	h0, err := parseHHMMClock(startS)
	if err != nil {
		return 0, 0, err
	}
	es := strings.TrimSpace(endS)
	if es == "24:00" || es == "24:0" || es == "24" {
		return h0, 24, nil
	}
	h1, err := parseHHMMClock(es)
	if err != nil {
		return 0, 0, err
	}
	if h1 == 24 {
		return h0, 24, nil
	}
	return h0, h1, nil
}

// AllowedShiftHours are the only valid calendar block sizes (hours).
var AllowedShiftHours = []float64{2, 3, 4}

// ValidateShiftHours reports whether blockHours is 2, 3, or 4.
func ValidateShiftHours(blockHours float64) error {
	for _, h := range AllowedShiftHours {
		if math.Abs(blockHours-h) < 1e-5 {
			return nil
		}
	}
	return fmt.Errorf("shift_hours must be 2, 3, or 4 (got %v)", blockHours)
}

// CalendarBlocksPerDaySafe returns 24/shift_hours if it divides evenly.
func CalendarBlocksPerDaySafe(blockHours float64) (int, error) {
	if err := ValidateShiftHours(blockHours); err != nil {
		return 0, err
	}
	if blockHours <= 0 {
		return 0, fmt.Errorf("block_hours must be positive")
	}
	q := 24.0 / blockHours
	n := int(math.Round(q))
	if math.Abs(float64(n)*blockHours-24.0) > 1e-5 {
		return 0, fmt.Errorf("24 must divide evenly by shift_hours (got %v)", blockHours)
	}
	return n, nil
}

package guardsched

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

type typeQuotaEntry struct {
	code string
	q    int
}

// sortedTypeQuotas orders minimum picks: descending quota, scarcer roster type, stable code.
func sortedTypeQuotas(quotas map[string]int, typeCodes []string) []typeQuotaEntry {
	if len(quotas) == 0 {
		return nil
	}
	rosterCount := map[string]int{}
	for _, tc := range typeCodes {
		rosterCount[tc]++
	}
	var entries []typeQuotaEntry
	for code, q := range quotas {
		entries = append(entries, typeQuotaEntry{code: code, q: q})
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].q != entries[j].q {
			return entries[i].q > entries[j].q
		}
		ci := rosterCount[entries[i].code]
		cj := rosterCount[entries[j].code]
		if ci != cj {
			return ci < cj
		}
		return entries[i].code < entries[j].code
	})
	return entries
}

func soldierTypeCode(typeCodes []string, idx int) string {
	if idx < 0 || idx >= len(typeCodes) {
		return ""
	}
	return strings.TrimSpace(typeCodes[idx])
}

func soldierPlatoonCode(platoonCodes []string, idx int) string {
	if idx < 0 || idx >= len(platoonCodes) {
		return ""
	}
	return strings.TrimSpace(platoonCodes[idx])
}

func (z *ZoneConfig) slotTypeExclude(locI int) map[string]struct{} {
	if locI < 0 || locI >= len(z.Locations) {
		return nil
	}
	return z.TypeExcludes[z.Locations[locI].TypeID]
}

func soldierExcludedByType(typeCodes []string, idx int, excluded map[string]struct{}) bool {
	if len(excluded) == 0 || len(typeCodes) == 0 {
		return false
	}
	_, ok := excluded[soldierTypeCode(typeCodes, idx)]
	return ok
}

// rotatingDfsTypeExclude returns the union of type excludes across all rotating slot types.
// Mixed rotating types (e.g. gate + valero) use the combined exclude set so DFS can run.
func (z *ZoneConfig) rotatingDfsTypeExclude(rotSlotIndices []int) (excluded map[string]struct{}, ok bool) {
	if len(rotSlotIndices) == 0 {
		return nil, true
	}
	union := map[string]struct{}{}
	for _, sidx := range rotSlotIndices {
		if sidx < 0 || sidx >= len(z.Slots) {
			continue
		}
		tid := z.Locations[z.Slots[sidx].LocationIndex].TypeID
		for code := range z.TypeExcludes[tid] {
			union[code] = struct{}{}
		}
	}
	return union, true
}

func fillFullDayTeamPost(
	zone *ZoneConfig,
	day, assignmentDay, sidx, locI int,
	cfg FullDayTeamSpec,
	soldiers []*Soldier,
	typeCodes, platoonCodes []string,
	busy [][][]bool,
	dailyRawLoc [][][]float64,
	dailyRawTime [][][]float64,
	deltasLoc, deltasTime [][]float64,
	deltasG []float64,
	simZ *Zone,
	B int,
	sh float64,
	days int,
	planDayStartHour int,
	r *PyRandom,
	bandRelative float64,
	balanceTotalHours bool,
	totalHoursSlack float64,
	avail AvailabilityChecker,
	assignments *[]*AssignmentRecord,
	pinWins map[string]int,
) error {
	if cfg.PinPlatoon {
		winPc, err := fillFullDayTeamPostPinPlatoon(
			zone, day, assignmentDay, sidx, locI, cfg, soldiers, typeCodes, platoonCodes,
			busy, dailyRawLoc, dailyRawTime, deltasLoc, deltasTime, deltasG, simZ,
			B, sh, days, planDayStartHour, r, bandRelative, balanceTotalHours, totalHoursSlack, avail, assignments, pinWins,
		)
		if err != nil {
			return err
		}
		if pinWins != nil && winPc != "" {
			pinWins[winPc]++
		}
		return nil
	}
	return fillFullDayTeamPostForPlatoon(
		zone, day, assignmentDay, sidx, locI, cfg, soldiers, typeCodes, platoonCodes,
		platoonPickAny, "",
		busy, dailyRawLoc, dailyRawTime, deltasLoc, deltasTime, deltasG, simZ,
		B, sh, days, planDayStartHour, r, bandRelative, balanceTotalHours, totalHoursSlack, avail, assignments,
	)
}

// platoonPickMode controls how fillFullDayTeamPostForPlatoon filters by platoon_code.
type platoonPickMode int

const (
	platoonPickStrict platoonPickMode = iota // all seats from preferred platoon only
	platoonPickPrefer                        // prefer preferred platoon per seat, then any platoon
	platoonPickAny                           // no platoon filter
)

func soldierEligibleFullDayTeam(
	s *Soldier,
	assigned []*Soldier,
	platoonCodes []string,
	platoonFilter, typeFilter string,
	typeCodes []string,
	excl map[string]struct{},
	busy [][][]bool,
	L0, span, B, days int,
	day, sh0, sh1 int,
	avail AvailabilityChecker,
) bool {
	if containsSoldier(assigned, s) {
		return false
	}
	if platoonFilter != "" && soldierPlatoonCode(platoonCodes, s.Idx) != platoonFilter {
		return false
	}
	if typeFilter != "" && soldierTypeCode(typeCodes, s.Idx) != typeFilter {
		return false
	}
	if soldierExcludedByType(typeCodes, s.Idx, excl) {
		return false
	}
	if anyBusySpan(busy, s.Idx, L0, span, B, days) {
		return false
	}
	return soldierAvail(avail, s.Idx, day, func() bool {
		return avail.AvailDutyWallHours(s.Idx, day, sh0, sh1+1)
	})
}

func platoonCanFillFullDayTeam(
	platoon string,
	cfg FullDayTeamSpec,
	soldiers []*Soldier,
	typeCodes, platoonCodes []string,
	excl map[string]struct{},
	busy [][][]bool,
	L0, span, B, days int,
	day, sh0, sh1 int,
	avail AvailabilityChecker,
) bool {
	typeAvail := map[string]int{}
	generic := 0
	for _, s := range soldiers {
		if !soldierEligibleFullDayTeam(s, nil, platoonCodes, platoon, "", typeCodes, excl, busy, L0, span, B, days, day, sh0, sh1, avail) {
			continue
		}
		tc := soldierTypeCode(typeCodes, s.Idx)
		if tc != "" {
			typeAvail[tc]++
		} else {
			generic++
		}
	}
	for code, q := range cfg.TypeQuotas {
		if typeAvail[code] < q {
			return false
		}
	}
	total := 0
	for _, n := range typeAvail {
		total += n
	}
	total += generic
	return total >= cfg.Headcount
}

// platoonCanFillFullDayTeamPinPick reports whether prefer-mode fill could succeed:
// army-wide quota counts are met and the platoon has at least one eligible soldier.
func platoonCanFillFullDayTeamPinPick(
	platoon string,
	cfg FullDayTeamSpec,
	soldiers []*Soldier,
	typeCodes, platoonCodes []string,
	excl map[string]struct{},
	busy [][][]bool,
	L0, span, B, days int,
	day, sh0, sh1 int,
	avail AvailabilityChecker,
) bool {
	globalType := map[string]int{}
	platoonN := 0
	for _, s := range soldiers {
		if !soldierEligibleFullDayTeam(s, nil, platoonCodes, "", "", typeCodes, excl, busy, L0, span, B, days, day, sh0, sh1, avail) {
			continue
		}
		tc := soldierTypeCode(typeCodes, s.Idx)
		if tc != "" {
			globalType[tc]++
		}
		if soldierEligibleFullDayTeam(s, nil, platoonCodes, platoon, "", typeCodes, excl, busy, L0, span, B, days, day, sh0, sh1, avail) {
			platoonN++
		}
	}
	for code, q := range cfg.TypeQuotas {
		if globalType[code] < q {
			return false
		}
	}
	return platoonN > 0
}

func soldierEffectiveGlobal(s *Soldier, dg float64) float64 {
	den := s.AvailableHours
	if den < 1e-9 {
		den = 1e-9
	}
	return (s.WGlobal + dg) / den
}

const pinPlatoonUniformScarceMax = 3

func pinPlatoonUniformScarceTypes(
	platoonCodes, typeCodes []string,
	quotas map[string]int,
) map[string]struct{} {
	out := map[string]struct{}{}
	if len(platoonCodes) == 0 || len(typeCodes) == 0 || len(quotas) == 0 {
		return out
	}
	platoonSet := map[string]struct{}{}
	var platoons []string
	for _, pc := range platoonCodes {
		pc = strings.TrimSpace(pc)
		if pc == "" {
			continue
		}
		if _, ok := platoonSet[pc]; ok {
			continue
		}
		platoonSet[pc] = struct{}{}
		platoons = append(platoons, pc)
	}
	sort.Strings(platoons)
	if len(platoons) == 0 {
		return out
	}
	counts := make(map[string]map[string]int, len(platoons))
	for _, p := range platoons {
		counts[p] = map[string]int{}
	}
	for idx, pc := range platoonCodes {
		p := strings.TrimSpace(pc)
		if p == "" {
			continue
		}
		row, ok := counts[p]
		if !ok {
			continue
		}
		tc := soldierTypeCode(typeCodes, idx)
		if tc == "" {
			continue
		}
		row[tc]++
	}
	for code, q := range quotas {
		if q > 1 {
			continue
		}
		if len(platoons) == 0 {
			continue
		}
		c0 := counts[platoons[0]][code]
		if c0 <= 0 || c0 > pinPlatoonUniformScarceMax {
			continue
		}
		uniform := true
		for _, p := range platoons[1:] {
			if counts[p][code] != c0 {
				uniform = false
				break
			}
		}
		if uniform {
			out[code] = struct{}{}
		}
	}
	return out
}

// pinPlatoonRotationTypes: quota seats that steer day-to-day platoon pick (uniform scarce + any q==1 seat).
func pinPlatoonRotationTypes(
	platoonCodes, typeCodes []string,
	quotas map[string]int,
) map[string]struct{} {
	out := pinPlatoonUniformScarceTypes(platoonCodes, typeCodes, quotas)
	for code, q := range quotas {
		if q == 1 {
			out[code] = struct{}{}
		}
	}
	return out
}

func effectiveLoadsByType(eligible []*Soldier, typeCodes []string, deltasG []float64) map[string][]float64 {
	byType := map[string][]float64{}
	for _, s := range eligible {
		tc := soldierTypeCode(typeCodes, s.Idx)
		if tc == "" {
			continue
		}
		byType[tc] = append(byType[tc], soldierEffectiveGlobal(s, deltasG[s.Idx]))
	}
	for tc := range byType {
		sort.Float64s(byType[tc])
	}
	return byType
}

// crossPlatoonQuotaPenalty is added to rotation cost when a platoon must pull a quota seat from outside.
const crossPlatoonQuotaPenalty = 2.0

// pinPlatoonRepeatPenalty steers pin_platoon away from the same preferred platoon on consecutive days
// when quota rotation cannot rely on per-platoon soldier load (e.g. one global H holder).
const pinPlatoonRepeatPenalty = 4.0

func platoonQuotaLoadCost(
	cfg FullDayTeamSpec,
	localByType, globalByType map[string][]float64,
	typeCodes []string,
	rotationTypes map[string]struct{},
) float64 {
	if len(cfg.TypeQuotas) == 0 || len(rotationTypes) == 0 {
		return 0
	}
	var cost float64
	for _, ent := range sortedTypeQuotas(cfg.TypeQuotas, typeCodes) {
		if _, ok := rotationTypes[ent.code]; !ok {
			continue
		}
		local := append([]float64(nil), localByType[ent.code]...)
		global := append([]float64(nil), globalByType[ent.code]...)
		if len(local) >= ent.q {
			for i := 0; i < ent.q; i++ {
				cost += local[i]
			}
			continue
		}
		if len(global) < ent.q {
			continue
		}
		for i := 0; i < ent.q; i++ {
			cost += global[i]
		}
		cost += crossPlatoonQuotaPenalty
	}
	return cost
}

func platoonFullDayTeamScore(
	platoon string,
	cfg FullDayTeamSpec,
	soldiers []*Soldier,
	typeCodes, platoonCodes []string,
	excl map[string]struct{},
	busy [][][]bool,
	L0, span, B, days int,
	day, sh0, sh1 int,
	avail AvailabilityChecker,
	deltasG []float64,
	globalByType map[string][]float64,
	rotationTypes map[string]struct{},
	pinWins map[string]int,
) (ok bool, score float64) {
	if !platoonCanFillFullDayTeamPinPick(platoon, cfg, soldiers, typeCodes, platoonCodes, excl, busy, L0, span, B, days, day, sh0, sh1, avail) {
		return false, 0
	}
	var eligible []*Soldier
	for _, s := range soldiers {
		if !soldierEligibleFullDayTeam(s, nil, platoonCodes, platoon, "", typeCodes, excl, busy, L0, span, B, days, day, sh0, sh1, avail) {
			continue
		}
		eligible = append(eligible, s)
	}
	localByType := effectiveLoadsByType(eligible, typeCodes, deltasG)
	quotaCost := platoonQuotaLoadCost(cfg, localByType, globalByType, typeCodes, rotationTypes)
	repeat := 0.0
	if pinWins != nil {
		repeat = float64(pinWins[platoon]) * pinPlatoonRepeatPenalty
	}
	return true, float64(len(eligible)) - quotaCost*1e6 - repeat*1e6
}

func orderedPlatoonsForFullDayTeam(
	cfg FullDayTeamSpec,
	soldiers []*Soldier,
	typeCodes, platoonCodes []string,
	excl map[string]struct{},
	busy [][][]bool,
	L0, span, B, days int,
	day, sh0, sh1 int,
	avail AvailabilityChecker,
	deltasG []float64,
	pinWins map[string]int,
) []string {
	seen := map[string]struct{}{}
	var codes []string
	for _, pc := range platoonCodes {
		if pc == "" {
			continue
		}
		if _, ok := seen[pc]; ok {
			continue
		}
		seen[pc] = struct{}{}
		codes = append(codes, pc)
	}
	var globalEligible []*Soldier
	for _, s := range soldiers {
		if !soldierEligibleFullDayTeam(s, nil, platoonCodes, "", "", typeCodes, excl, busy, L0, span, B, days, day, sh0, sh1, avail) {
			continue
		}
		globalEligible = append(globalEligible, s)
	}
	globalByType := effectiveLoadsByType(globalEligible, typeCodes, deltasG)
	rotationTypes := pinPlatoonRotationTypes(platoonCodes, typeCodes, cfg.TypeQuotas)
	type ranked struct {
		code  string
		ok    bool
		score float64
	}
	ranks := make([]ranked, 0, len(codes))
	for _, pc := range codes {
		ok, sc := platoonFullDayTeamScore(pc, cfg, soldiers, typeCodes, platoonCodes, excl, busy, L0, span, B, days, day, sh0, sh1, avail, deltasG, globalByType, rotationTypes, pinWins)
		ranks = append(ranks, ranked{code: pc, ok: ok, score: sc})
	}
	sort.SliceStable(ranks, func(i, j int) bool {
		if ranks[i].ok != ranks[j].ok {
			return ranks[i].ok && !ranks[j].ok
		}
		if ranks[i].score != ranks[j].score {
			return ranks[i].score > ranks[j].score
		}
		return ranks[i].code < ranks[j].code
	})
	out := make([]string, 0, len(ranks))
	for _, r := range ranks {
		out = append(out, r.code)
	}
	return out
}

func fillFullDayTeamPostPinPlatoon(
	zone *ZoneConfig,
	day, assignmentDay, sidx, locI int,
	cfg FullDayTeamSpec,
	soldiers []*Soldier,
	typeCodes, platoonCodes []string,
	busy [][][]bool,
	dailyRawLoc [][][]float64,
	dailyRawTime [][][]float64,
	deltasLoc, deltasTime [][]float64,
	deltasG []float64,
	simZ *Zone,
	B int,
	sh float64,
	days int,
	planDayStartHour int,
	r *PyRandom,
	bandRelative float64,
	balanceTotalHours bool,
	totalHoursSlack float64,
	avail AvailabilityChecker,
	assignments *[]*AssignmentRecord,
	pinWins map[string]int,
) (string, error) {
	sh0, sh1 := cfg.StartH, cfg.EndH
	L0, span := linearBusySpanDutyHoursPlusRest(day, B, sh, sh0, sh1, false, cfg.RestAfterH, planDayStartHour)
	excl := zone.slotTypeExclude(locI)
	clear2D(deltasLoc)
	clear2D(deltasTime)
	clear1D(deltasG)
	order := orderedPlatoonsForFullDayTeam(cfg, soldiers, typeCodes, platoonCodes, excl, busy, L0, span, B, days, day, sh0, sh1, avail, deltasG, pinWins)
	if len(order) == 0 {
		return "", fmt.Errorf("pin_platoon: no soldiers with platoon_code on day %d slot %d", day+1, sidx+1)
	}
	var lastErr error
	for _, pc := range order {
		err := fillFullDayTeamPostForPlatoon(
			zone, day, assignmentDay, sidx, locI, cfg, soldiers, typeCodes, platoonCodes,
			platoonPickStrict, pc,
			busy, dailyRawLoc, dailyRawTime, deltasLoc, deltasTime, deltasG, simZ,
			B, sh, days, planDayStartHour, r, bandRelative, balanceTotalHours, totalHoursSlack, avail, assignments,
		)
		if err == nil {
			return pc, nil
		}
		lastErr = err
		err = fillFullDayTeamPostForPlatoon(
			zone, day, assignmentDay, sidx, locI, cfg, soldiers, typeCodes, platoonCodes,
			platoonPickPrefer, pc,
			busy, dailyRawLoc, dailyRawTime, deltasLoc, deltasTime, deltasG, simZ,
			B, sh, days, planDayStartHour, r, bandRelative, balanceTotalHours, totalHoursSlack, avail, assignments,
		)
		if err == nil {
			return pc, nil
		}
		lastErr = err
	}
	if lastErr != nil {
		return "", fmt.Errorf("pin_platoon: no platoon can fill team on day %d slot %d: %w", day+1, sidx+1, lastErr)
	}
	return "", fmt.Errorf("pin_platoon: no platoon can fill team on day %d slot %d", day+1, sidx+1)
}

func fullDayTeamPickPool(
	soldiers []*Soldier,
	assigned []*Soldier,
	platoonCodes []string,
	preferredPlatoon string,
	mode platoonPickMode,
	typeFilter string,
	typeCodes []string,
	excl map[string]struct{},
	busy [][][]bool,
	L0, span, B, days int,
	day, sh0, sh1 int,
	avail AvailabilityChecker,
) []*Soldier {
	platoonFilter := ""
	switch mode {
	case platoonPickStrict:
		platoonFilter = preferredPlatoon
	case platoonPickPrefer:
		// eligibility without platoon filter; partition below
	default:
		// platoonPickAny
	}
	if mode != platoonPickPrefer {
		var pool []*Soldier
		for _, s := range soldiers {
			if soldierEligibleFullDayTeam(s, assigned, platoonCodes, platoonFilter, typeFilter, typeCodes, excl, busy, L0, span, B, days, day, sh0, sh1, avail) {
				pool = append(pool, s)
			}
		}
		return pool
	}
	var preferred, other []*Soldier
	for _, s := range soldiers {
		if !soldierEligibleFullDayTeam(s, assigned, platoonCodes, "", typeFilter, typeCodes, excl, busy, L0, span, B, days, day, sh0, sh1, avail) {
			continue
		}
		if soldierPlatoonCode(platoonCodes, s.Idx) == preferredPlatoon {
			preferred = append(preferred, s)
		} else {
			other = append(other, s)
		}
	}
	if len(preferred) > 0 {
		return preferred
	}
	return other
}

func fillFullDayTeamPostForPlatoon(
	zone *ZoneConfig,
	day, assignmentDay, sidx, locI int,
	cfg FullDayTeamSpec,
	soldiers []*Soldier,
	typeCodes, platoonCodes []string,
	mode platoonPickMode,
	preferredPlatoon string,
	busy [][][]bool,
	dailyRawLoc [][][]float64,
	dailyRawTime [][][]float64,
	deltasLoc, deltasTime [][]float64,
	deltasG []float64,
	simZ *Zone,
	B int,
	sh float64,
	days int,
	planDayStartHour int,
	r *PyRandom,
	bandRelative float64,
	balanceTotalHours bool,
	totalHoursSlack float64,
	avail AvailabilityChecker,
	assignments *[]*AssignmentRecord,
) error {
	sh0, sh1 := cfg.StartH, cfg.EndH
	L0, span := linearBusySpanDutyHoursPlusRest(day, B, sh, sh0, sh1, false, cfg.RestAfterH, planDayStartHour)
	lw := zone.Locations[locI].Weight
	wm := cfg.WeightMult
	hf := cfg.HoursFactor
	if hf <= 0 {
		hf = 1
	}
	rawActive := fullDayRawActiveHours(sh0, sh1) * hf
	b0, b1 := dutyBlocksPlanAligned(sh, sh0, sh1, planDayStartHour, B)
	dutyW := b1 - b0 + 1
	timeMid := timeCategoryForHour((sh0+sh1)/2, simZ)

	var assigned []*Soldier
	excl := zone.slotTypeExclude(locI)
	pickN := func(n int, typeFilter string) error {
		for pick := 0; pick < n; pick++ {
			pool := fullDayTeamPickPool(
				soldiers, assigned, platoonCodes, preferredPlatoon, mode, typeFilter,
				typeCodes, excl, busy, L0, span, B, days, day, sh0, sh1, avail,
			)
			if len(pool) == 0 {
				if typeFilter != "" {
					return fmt.Errorf("full_day_team: need %d type %s, have %d available on day %d slot %d",
						n, typeFilter, pick, day+1, sidx+1)
				}
				return fmt.Errorf("full_day_team: cannot fill %d generic seats on day %d slot %d", n-pick, day+1, sidx+1)
			}
			chosen := pickSoldier(pool, locI, timeMid, deltasLoc, deltasTime, deltasG, r, bandRelative, balanceTotalHours, totalHoursSlack, nil)
			assigned = append(assigned, chosen)
		}
		return nil
	}

	clear2D(deltasLoc)
	clear2D(deltasTime)
	clear1D(deltasG)

	for _, ent := range sortedTypeQuotas(cfg.TypeQuotas, typeCodes) {
		if err := pickN(ent.q, ent.code); err != nil {
			return err
		}
	}
	remaining := cfg.Headcount - len(assigned)
	if remaining > 0 {
		if err := pickN(remaining, ""); err != nil {
			return err
		}
	}

	for _, chosen := range assigned {
		totW := 0.0
		forEachFullDayDutyHour(sh0, sh1, func(h int) {
			tj := timeCategoryForHour(h, simZ)
			tw := zone.TimeBands[tj].Weight
			wpart := lw * tw * wm * hf
			totW += wpart
			chosen.addAssignment(locI, tj, wpart, hf)
		})
		busySpanSet(busy, chosen.Idx, L0, span, B, days)
		dailyRawLoc[day][chosen.Idx][locI] += rawActive
		forEachFullDayDutyHour(sh0, sh1, func(h int) {
			tj := timeCategoryForHour(h, simZ)
			dailyRawTime[day][chosen.Idx][tj] += hf
		})
		spanB0 := LinearBusySpanCalendarBlock(day, B, L0)
		*assignments = append(*assignments, &AssignmentRecord{
			Day: assignmentDay, CalendarBlock: spanB0, StartHour: BlockStartHour(planDayStartHour, spanB0, sh), Slot: sidx,
			SoldierIdx: chosen.Idx, LocI: locI, TimeJ: timeMid, Weight: totW, RawHours: rawActive,
			Kind: "full_day_team", Rowspan: dutyW, WinStartBlock: b0, WinEndBlock: b1,
			LinearBusySpanBlocks: span,
		})
	}
	return nil
}

func pickSoldiersForSlot(
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
) ([]*Soldier, error) {
	var assigned []*Soldier
	for i := 0; i < n; i++ {
		pool := poolBase(assigned)
		if len(pool) == 0 {
			return nil, fmt.Errorf("need %d soldiers, have %d available", n, i)
		}
		chosen := pickSoldier(pool, locI, timeMid, deltasLoc, deltasTime, deltasG, r, bandRelative, balanceTotalHours, totalHoursSlack, rotPf)
		assigned = append(assigned, chosen)
	}
	return assigned, nil
}

func pickSoldiersForRotatingSlot(
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
) ([]*Soldier, error) {
	var assigned []*Soldier
	for i := 0; i < n; i++ {
		pool := poolBase(assigned)
		if len(pool) == 0 {
			return nil, fmt.Errorf("need %d soldiers, have %d available", n, i)
		}
		chosen := pickRotatingSoldier(pool, locI, timeMid, deltasLoc, deltasTime, deltasG, r, bandRelative, balanceTotalHours, totalHoursSlack, rotPf)
		assigned = append(assigned, chosen)
	}
	return assigned, nil
}

func slotDisabledForDay(zone *ZoneConfig, sidx, day, planStartHour int, anchor *time.Time) bool {
	if anchor == nil || anchor.IsZero() {
		return false
	}
	locI := zone.Slots[sidx].LocationIndex
	tid := zone.Locations[locI].TypeID
	wd := WeekdayAtPlanDayStart(*anchor, day, planStartHour)
	return zone.IsSlotTypeDisabledOnWeekday(tid, wd)
}

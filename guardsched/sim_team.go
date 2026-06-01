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

// rotatingDfsTypeExclude returns the exclude set for rotating DFS when all rotating slots share
// one type id. ok is false when mixed rotating type ids and any has a non-empty exclude (skip DFS).
func (z *ZoneConfig) rotatingDfsTypeExclude(rotSlotIndices []int) (excluded map[string]struct{}, ok bool) {
	if len(rotSlotIndices) == 0 {
		return nil, true
	}
	tids := map[string]struct{}{}
	var only string
	for _, sidx := range rotSlotIndices {
		if sidx < 0 || sidx >= len(z.Slots) {
			continue
		}
		tid := z.Locations[z.Slots[sidx].LocationIndex].TypeID
		tids[tid] = struct{}{}
		if only == "" {
			only = tid
		}
	}
	if len(tids) == 1 {
		return z.TypeExcludes[only], true
	}
	for tid := range tids {
		if len(z.TypeExcludes[tid]) > 0 {
			return nil, false
		}
	}
	return nil, true
}

func fillFullDayTeamPost(
	zone *ZoneConfig,
	day, assignmentDay, sidx, locI int,
	cfg FullDayTeamSpec,
	soldiers []*Soldier,
	typeCodes []string,
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
			var pool []*Soldier
			for _, s := range soldiers {
				if containsSoldier(assigned, s) {
					continue
				}
				if typeFilter != "" && soldierTypeCode(typeCodes, s.Idx) != typeFilter {
					continue
				}
				if soldierExcludedByType(typeCodes, s.Idx, excl) {
					continue
				}
				if !anyBusySpan(busy, s.Idx, L0, span, B, days) &&
					soldierAvail(avail, s.Idx, day, func() bool {
						return avail.AvailDutyWallHours(s.Idx, day, sh0, sh1+1)
					}) {
					pool = append(pool, s)
				}
			}
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

func slotDisabledForDay(zone *ZoneConfig, sidx, day, planStartHour int, anchor *time.Time) bool {
	if anchor == nil || anchor.IsZero() {
		return false
	}
	locI := zone.Slots[sidx].LocationIndex
	tid := zone.Locations[locI].TypeID
	wd := WeekdayAtPlanDayStart(*anchor, day, planStartHour)
	return zone.IsSlotTypeDisabledOnWeekday(tid, wd)
}

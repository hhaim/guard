package guardsched

import (
	"fmt"
	"sort"
	"time"
)

func checkpointNonrotatingRecords(prefix []*AssignmentRecord) []*AssignmentRecord {
	var out []*AssignmentRecord
	for _, a := range prefix {
		if a == nil {
			continue
		}
		k := a.Kind
		if k == "" {
			k = "rotating"
		}
		if k == "rotating" {
			continue
		}
		cp := *a
		out = append(out, &cp)
	}
	return out
}

func checkpointRotatingPrefix(prefix []*AssignmentRecord, prefixDays int) []*AssignmentRecord {
	var out []*AssignmentRecord
	for _, a := range prefix {
		if a == nil {
			continue
		}
		k := a.Kind
		if k == "" {
			k = "rotating"
		}
		if k == "rotating" && a.Day < prefixDays {
			cp := *a
			out = append(out, &cp)
		}
	}
	return out
}

// CheckpointReplaySortKey orders replay rows like Python checkpoint_replay_sort_key.
func CheckpointReplaySortKey(a *AssignmentRecord) (int, int, int, int) {
	k := a.Kind
	if k == "" {
		k = "rotating"
	}
	phase := 2
	switch k {
	case "full_day", "full_day_team":
		phase = 0
	case "windowed":
		phase = 1
	}
	return a.Day, phase, a.CalendarBlock, a.Slot
}

// ReplayPrefixAssignments replays fixed assignments into busy tensors and soldier weights (no picks).
// Matches Python replay_checkpoint_assignments.
func ReplayPrefixAssignments(
	zone *ZoneConfig,
	soldiers []*Soldier,
	busy, busyRot [][][]bool,
	dailyRawLoc, dailyRawTime [][][]float64,
	records []*AssignmentRecord,
	totalDays, blocksPd, planDayStartHour int,
) error {
	sh := zone.ShiftHours
	simZ := zone.ToZone()
	ordered := append([]*AssignmentRecord(nil), records...)
	sort.Slice(ordered, func(i, j int) bool {
		di, pi, bi, si := CheckpointReplaySortKey(ordered[i])
		dj, pj, bj, sj := CheckpointReplaySortKey(ordered[j])
		if di != dj {
			return di < dj
		}
		if pi != pj {
			return pi < pj
		}
		if bi != bj {
			return bi < bj
		}
		return si < sj
	})
	for _, a := range ordered {
		if a == nil || a.SoldierIdx < 0 || a.SoldierIdx >= len(soldiers) {
			continue
		}
		k := a.Kind
		if k == "" {
			k = "rotating"
		}
		s := soldiers[a.SoldierIdx]
		day := a.Day
		if day < 0 || day >= totalDays {
			continue
		}
		switch k {
		case "rotating":
			b := a.CalendarBlock
			locI, timeJ := a.LocI, a.TimeJ
			weight, rh := a.Weight, a.RawHours
			if rh <= 0 {
				rh = sh
			}
			s.addAssignment(locI, timeJ, weight, rh)
			busy[day][s.Idx][b] = true
			busyRot[day][s.Idx][b] = true
			dailyRawLoc[day][s.Idx][locI] += rh
			dailyRawTime[day][s.Idx][timeJ] += rh
		case "full_day", "full_day_team":
			locI := a.LocI
			tid := zone.Locations[locI].TypeID
			var sh0, sh1 int
			var restAfter, wm, hf float64
			if k == "full_day_team" {
				cfg := zone.FullDayTeamSpecs[tid]
				sh0, sh1 = cfg.StartH, cfg.EndH
				restAfter = cfg.RestAfterH
				wm = cfg.WeightMult
				hf = cfg.HoursFactor
				if hf <= 0 {
					hf = 1
				}
			} else {
				cfg := zone.FullDaySpecs[tid]
				sh0, sh1 = cfg.StartH, cfg.EndH
				restAfter = cfg.RestAfterH
				wm = cfg.WeightMult
				hf = cfg.HoursFactor
				if hf <= 0 {
					hf = 1
				}
			}
			lw := zone.Locations[locI].Weight
			rawActive := fullDayRawActiveHours(sh0, sh1) * hf
			L0, span := linearBusySpanDutyHoursPlusRest(day, blocksPd, sh, sh0, sh1, false, restAfter, planDayStartHour)
			forEachFullDayDutyHour(sh0, sh1, func(h int) {
				tj := timeCategoryForHour(h, simZ)
				tw := zone.TimeBands[tj].Weight
				s.addAssignment(locI, tj, lw*tw*wm*hf, hf)
			})
			busySpanSet(busy, s.Idx, L0, span, blocksPd, totalDays)
			dailyRawLoc[day][s.Idx][locI] += rawActive
			forEachFullDayDutyHour(sh0, sh1, func(h int) {
				tj := timeCategoryForHour(h, simZ)
				dailyRawTime[day][s.Idx][tj] += hf
			})
		case "windowed":
			locI := a.LocI
			tid := zone.Locations[locI].TypeID
			wins := zone.WindowedSpecs[tid]
			restH := zone.WindowedRestHours[tid]
			lw := zone.Locations[locI].Weight
			wdef := resolveWindowedSpec(wins, a, sh)
			if wdef == nil {
				return fmt.Errorf("checkpoint replay: cannot resolve windowed slot=%d day=%d name=%q", a.Slot, day, a.WindowName)
			}
			h0, h1x := wdef.H0, wdef.H1Excl
			wm := wdef.WeightMult
			rawActive := float64(max(0, h1x-h0))
			L0, span := linearBusySpanDutyHoursPlusRest(day, blocksPd, sh, h0, h1x, true, restH, planDayStartHour)
			for h := h0; h < h1x; h++ {
				tj := timeCategoryForHour(h, simZ)
				tw := zone.TimeBands[tj].Weight
				s.addAssignment(locI, tj, lw*tw*wm, 1.0)
			}
			busySpanSet(busy, s.Idx, L0, span, blocksPd, totalDays)
			dailyRawLoc[day][s.Idx][locI] += rawActive
			for h := h0; h < h1x; h++ {
				tj := timeCategoryForHour(h, simZ)
				dailyRawTime[day][s.Idx][tj] += 1.0
			}
		default:
			return fmt.Errorf("checkpoint replay: unknown kind %q", k)
		}
	}
	return nil
}

func resolveWindowedSpec(wins []WindowSpec, a *AssignmentRecord, shiftHours float64) *WindowSpec {
	wname := a.WindowName
	if wname != "" {
		for i := range wins {
			if wins[i].Name == wname {
				return &wins[i]
			}
		}
	}
	for i := range wins {
		b0c, b1c := dutyBlocksHalfOpenWallHours(shiftHours, wins[i].H0, wins[i].H1Excl)
		if b0c == a.WinStartBlock && b1c == a.WinEndBlock {
			return &wins[i]
		}
	}
	if len(wins) == 1 {
		return &wins[0]
	}
	return nil
}

// extendPlanAvail maps absolute sim day indices to plan-day availability (0 = anchor).
type extendPlanAvail struct {
	inner          AvailabilityChecker
	planDayOffset  int
}

func (e *extendPlanAvail) AvailIdx(idx, day int, dutyStart, dutyEnd time.Time) bool {
	if e.inner == nil {
		return true
	}
	return e.inner.AvailIdx(idx, day-e.planDayOffset, dutyStart, dutyEnd)
}

func (e *extendPlanAvail) AvailDutyWallHours(idx, day, h0, h1 int) bool {
	if e.inner == nil {
		return true
	}
	return e.inner.AvailDutyWallHours(idx, day-e.planDayOffset, h0, h1)
}

func (e *extendPlanAvail) AvailRotatingBlock(idx, day, block, planDayStartHour int, shiftHours float64) bool {
	if e.inner == nil {
		return true
	}
	return e.inner.AvailRotatingBlock(idx, day-e.planDayOffset, block, planDayStartHour, shiftHours)
}

// ExtendWitness carries RNG + suffix non-rotating rows from the cold run at split (checkpoint v2).
type ExtendWitness struct {
	RNGVersion   int
	RNGState     []uint32
	SuffixNonrot []*AssignmentRecord
}

// RunSimulationZoneConfigExtend replays prefix assignments then simulates extendDays more calendar days.
// When witness is set, restores RNG and replays suffix_nonrot instead of re-simulating those picks.
// Returned assignments are only the new segment, reindexed to day 0..extendDays-1.
func RunSimulationZoneConfigExtend(
	zone *ZoneConfig,
	numSoldiers, prefixDays, extendDays int,
	prefixAssignments []*AssignmentRecord,
	r *PyRandom,
	minConsecutiveFreeHours float64,
	balanceTotalHours bool,
	totalHoursSlack float64,
	maxConsecutiveDutyBlocks int,
	minFreeShiftsAfterDuty int,
	bandRelative float64,
	planDayStartHour int,
	avail AvailabilityChecker,
	anchor *time.Time,
	typeCodes, platoonCodes []string,
	witness *ExtendWitness,
) ([]*AssignmentRecord, *SimulationStats, error) {
	if extendDays < 1 {
		return nil, nil, fmt.Errorf("extend_days must be >= 1")
	}
	slotsPerBlock := zone.SlotsPerBlock()
	if numSoldiers < slotsPerBlock {
		return nil, nil, fmt.Errorf("need soldiers >= slots per block (%d)", slotsPerBlock)
	}
	sh := zone.ShiftHours
	B, err := CalendarBlocksPerDaySafe(sh)
	if err != nil {
		return nil, nil, err
	}
	blocksPd := B
	slotPatterns := make([]string, len(zone.Slots))
	for i, sl := range zone.Slots {
		slotPatterns[i] = sl.Pattern
	}
	nRot := countRotating(slotPatterns)
	if nRot > 0 {
		if err := assertRestFeasibleCounting(numSoldiers, blocksPd, nRot, sh, minConsecutiveFreeHours); err != nil {
			return nil, nil, err
		}
	}
	totalDays := prefixDays + extendDays
	simZ := zone.ToZone()
	nl := len(zone.Locations)
	nt := len(zone.TimeBands)

	soldiers := make([]*Soldier, numSoldiers)
	for i := range soldiers {
		soldiers[i] = makeSoldier(i, 0, nl, nt)
	}
	for day := 0; day < totalDays; day++ {
		for i := range soldiers {
			var add float64 = 24.0
			if avail != nil {
				bh, ah := availFairnessHours(avail, i, day)
				add = bh + ah
			}
			soldiers[i].AvailableHours += add
		}
	}
	busy := new3DBool(totalDays, numSoldiers, blocksPd)
	busyRot := new3DBool(totalDays, numSoldiers, blocksPd)
	dailyRawLoc := new3DFloat(totalDays, numSoldiers, nl)
	dailyRawTime := new3DFloat(totalDays, numSoldiers, nt)
	deltasLoc := new2DFloat(numSoldiers, nl)
	deltasTime := new2DFloat(numSoldiers, nt)
	deltasG := make([]float64, numSoldiers)

	if witness != nil && len(witness.RNGState) > 0 {
		if err := r.SetState(witness.RNGVersion, witness.RNGState, nil); err != nil {
			return nil, nil, err
		}
	}
	var rotPrefixReplay []*AssignmentRecord
	initialReplay := prefixAssignments
	if witness != nil {
		initialReplay = append(
			checkpointNonrotatingRecords(prefixAssignments),
			witness.SuffixNonrot...,
		)
		rotPrefixReplay = checkpointRotatingPrefix(prefixAssignments, prefixDays)
	}
	if err := ReplayPrefixAssignments(zone, soldiers, busy, busyRot, dailyRawLoc, dailyRawTime,
		initialReplay, totalDays, blocksPd, planDayStartHour); err != nil {
		return nil, nil, err
	}
	skipNonrotExtend := witness != nil && len(witness.SuffixNonrot) > 0

	kRest := consecutiveFreeBlocksNeeded(sh, minConsecutiveFreeHours)
	stats := &SimulationStats{}
	xCool := minFreeShiftsAfterDuty
	if xCool > 0 && minConsecutiveFreeHours > 0 && float64(xCool)*sh+1e-9 >= minConsecutiveFreeHours && nRot == slotsPerBlock {
		kRest = 0
	}
	kRestMask := kRest
	rotIdx := rotatingSlotIndices(slotPatterns)
	if len(rotIdx) != slotsPerBlock {
		kRestMask = 0
	}

	var extendAvail AvailabilityChecker
	if avail != nil {
		extendAvail = &extendPlanAvail{inner: avail, planDayOffset: prefixDays}
	}

	var newAssignments []*AssignmentRecord
	dayStart := prefixDays
	dayEnd := totalDays

	if !skipNonrotExtend {
	// --- full_day_team ---
	pinPlatoonWins := make(map[int]map[string]int)
	for day := dayStart; day < dayEnd; day++ {
		planDay := day - prefixDays
		clear2D(deltasLoc)
		clear1D(deltasG)
		clear2D(deltasTime)
		for sidx := 0; sidx < slotsPerBlock; sidx++ {
			if zone.Slots[sidx].Pattern != "full_day_team" {
				continue
			}
			if slotDisabledForDay(zone, sidx, planDay, planDayStartHour, anchor) {
				continue
			}
			locI := zone.Slots[sidx].LocationIndex
			tid := zone.Locations[locI].TypeID
			cfg := zone.FullDayTeamSpecs[tid]
			var pinWins map[string]int
			if cfg.PinPlatoon {
				pinWins = pinPlatoonWins[locI]
				if pinWins == nil {
					pinWins = make(map[string]int)
					pinPlatoonWins[locI] = pinWins
				}
			}
			if err := fillFullDayTeamPost(
				zone, day, planDay, sidx, locI, cfg, soldiers, typeCodes, platoonCodes, busy,
				dailyRawLoc, dailyRawTime, deltasLoc, deltasTime, deltasG, simZ,
				B, sh, totalDays, planDayStartHour, r, bandRelative, balanceTotalHours, totalHoursSlack, extendAvail, &newAssignments, pinWins, nil,
			); err != nil {
				return nil, nil, err
			}
		}
	}

	// --- full_day ---
	for day := dayStart; day < dayEnd; day++ {
		planDay := day - prefixDays
		clear2D(deltasLoc)
		clear1D(deltasG)
		clear2D(deltasTime)
		for sidx := 0; sidx < slotsPerBlock; sidx++ {
			if zone.Slots[sidx].Pattern != "full_day" {
				continue
			}
			if slotDisabledForDay(zone, sidx, planDay, planDayStartHour, anchor) {
				continue
			}
			locI := zone.Slots[sidx].LocationIndex
			tid := zone.Locations[locI].TypeID
			cfg := zone.FullDaySpecs[tid]
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
			nReq := cfg.Headcount
			if nReq < 1 {
				nReq = 1
			}
			clear2D(deltasLoc)
			clear2D(deltasTime)
			clear1D(deltasG)
			timeMid := timeCategoryForHour((sh0+sh1)/2, simZ)
			excl := zone.slotTypeExclude(locI)
			poolFn := func(assigned []*Soldier) []*Soldier {
				var pool []*Soldier
				for _, s := range soldiers {
					if containsSoldier(assigned, s) {
						continue
					}
					if soldierExcludedByType(typeCodes, s.Idx, excl) {
						continue
					}
					if !anyBusySpan(busy, s.Idx, L0, span, B, totalDays) &&
						soldierAvail(extendAvail, s.Idx, day, func() bool {
							return extendAvail.AvailDutyWallHours(s.Idx, day, sh0, sh1+1)
						}) {
						pool = append(pool, s)
					}
				}
				return pool
			}
			chosenList, err := pickSoldiersForSlot(
				nReq, poolFn, locI, timeMid, deltasLoc, deltasTime, deltasG, r,
				bandRelative, balanceTotalHours, totalHoursSlack, nil,
			)
			if err != nil {
				return nil, nil, fmt.Errorf("%w: full_day (extend) cannot fill day %d slot %d: %v", ErrRestConstraint, planDay+1, sidx+1, err)
			}
			for _, chosen := range chosenList {
				totW := 0.0
				forEachFullDayDutyHour(sh0, sh1, func(h int) {
					tj := timeCategoryForHour(h, simZ)
					tw := zone.TimeBands[tj].Weight
					wpart := lw * tw * wm * hf
					totW += wpart
					chosen.addAssignment(locI, tj, wpart, hf)
				})
				busySpanSet(busy, chosen.Idx, L0, span, B, totalDays)
				dailyRawLoc[day][chosen.Idx][locI] += rawActive
				forEachFullDayDutyHour(sh0, sh1, func(h int) {
					tj := timeCategoryForHour(h, simZ)
					dailyRawTime[day][chosen.Idx][tj] += hf
				})
				spanB0 := LinearBusySpanCalendarBlock(day, B, L0)
				newAssignments = append(newAssignments, &AssignmentRecord{
					Day: planDay, CalendarBlock: spanB0, StartHour: BlockStartHour(planDayStartHour, spanB0, sh), Slot: sidx,
					SoldierIdx: chosen.Idx, LocI: locI, TimeJ: timeMid, Weight: totW, RawHours: rawActive,
					Kind: "full_day", Rowspan: dutyW, WinStartBlock: b0, WinEndBlock: b1,
					LinearBusySpanBlocks: span,
				})
			}
		}
	}

	// --- windowed ---
	for day := dayStart; day < dayEnd; day++ {
		planDay := day - prefixDays
		clear2D(deltasLoc)
		clear2D(deltasTime)
		clear1D(deltasG)
		for sidx := 0; sidx < slotsPerBlock; sidx++ {
			if zone.Slots[sidx].Pattern != "windowed_slots" {
				continue
			}
			if slotDisabledForDay(zone, sidx, planDay, planDayStartHour, anchor) {
				continue
			}
			locI := zone.Slots[sidx].LocationIndex
			tid := zone.Locations[locI].TypeID
			wins := zone.WindowedSpecs[tid]
			restH := zone.WindowedRestHours[tid]
			lw := zone.Locations[locI].Weight
			exclWin := zone.slotTypeExclude(locI)
			var bestKey []float64
			var bestWI int
			var bestWdef *WindowSpec
			var bestTotW float64
			var bestWname string
			have := false
			for wi := range wins {
				wdef := &wins[wi]
				h0, h1x := wdef.H0, wdef.H1Excl
				wm := wdef.WeightMult
				rawActive := float64(max(0, h1x-h0))
				if rawActive <= 0 {
					continue
				}
				L0w, spanw := linearBusySpanDutyHoursPlusRest(day, B, sh, h0, h1x, true, restH, planDayStartHour)
				var pool []*Soldier
				for _, s := range soldiers {
					if soldierExcludedByType(typeCodes, s.Idx, exclWin) {
						continue
					}
					if !anyBusySpan(busy, s.Idx, L0w, spanw, B, totalDays) &&
						soldierAvail(extendAvail, s.Idx, day, func() bool {
							return extendAvail.AvailDutyWallHours(s.Idx, day, h0, h1x)
						}) {
						pool = append(pool, s)
					}
				}
				if len(pool) == 0 {
					continue
				}
				clear2D(deltasLoc)
				clear2D(deltasTime)
				clear1D(deltasG)
				hMid := h0
				if h1x > h0+1 {
					hMid = (h0 + h1x - 1) / 2
				}
				timeMid := timeCategoryForHour(hMid, simZ)
				cand := pickSoldier(pool, locI, timeMid, deltasLoc, deltasTime, deltasG, r, bandRelative, balanceTotalHours, totalHoursSlack, nil)
				key := hybridSortKeyTuple(cand, locI, timeMid, deltasLoc, deltasTime, deltasG[cand.Idx])
				wname := wdef.Name
				if wname == "" {
					wname = fmt.Sprintf("w%d", wi)
				}
				if !have || lexLessFloatSlice(key, bestKey) || (floatSliceEqual(key, bestKey) && wi < bestWI) {
					totW := 0.0
					for h := h0; h < h1x; h++ {
						tj := timeCategoryForHour(h, simZ)
						tw := zone.TimeBands[tj].Weight
						totW += lw * tw * wm
					}
					bestKey = key
					bestWI = wi
					bestWdef = wdef
					bestTotW = totW
					bestWname = wname
					have = true
				}
			}
			if !have {
				return nil, nil, fmt.Errorf("%w: windowed (extend) cannot fill day %d slot %d", ErrRestConstraint, planDay+1, sidx+1)
			}
			wdef := bestWdef
			h0, h1x := wdef.H0, wdef.H1Excl
			wm := wdef.WeightMult
			rawActive := float64(max(0, h1x-h0))
			L0, span := linearBusySpanDutyHoursPlusRest(day, B, sh, h0, h1x, true, restH, planDayStartHour)
			nReq := zone.WindowedHeadcount[tid]
			if nReq < 1 {
				nReq = 1
			}
			timeMid := timeCategoryForHour(h0, simZ)
			if h1x > h0+1 {
				timeMid = timeCategoryForHour((h0+h1x-1)/2, simZ)
			}
			clear2D(deltasLoc)
			clear2D(deltasTime)
			clear1D(deltasG)
			excl := zone.slotTypeExclude(locI)
			poolFn := func(assigned []*Soldier) []*Soldier {
				var pool []*Soldier
				for _, s := range soldiers {
					if containsSoldier(assigned, s) {
						continue
					}
					if soldierExcludedByType(typeCodes, s.Idx, excl) {
						continue
					}
					if !anyBusySpan(busy, s.Idx, L0, span, B, totalDays) &&
						soldierAvail(extendAvail, s.Idx, day, func() bool {
							return extendAvail.AvailDutyWallHours(s.Idx, day, h0, h1x)
						}) {
						pool = append(pool, s)
					}
				}
				return pool
			}
			chosenList, err := pickSoldiersForSlot(
				nReq, poolFn, locI, timeMid, deltasLoc, deltasTime, deltasG, r,
				bandRelative, balanceTotalHours, totalHoursSlack, nil,
			)
			if err != nil {
				return nil, nil, fmt.Errorf("%w: windowed (extend) cannot fill day %d slot %d: %v", ErrRestConstraint, planDay+1, sidx+1, err)
			}
			b0, b1 := dutyBlocksHalfOpenWallHours(sh, h0, h1x)
			rowspan := max(1, b1-b0+1)
			for _, chosen := range chosenList {
				for h := h0; h < h1x; h++ {
					tj := timeCategoryForHour(h, simZ)
					tw := zone.TimeBands[tj].Weight
					wpart := lw * tw * wm
					chosen.addAssignment(locI, tj, wpart, 1.0)
				}
				busySpanSet(busy, chosen.Idx, L0, span, B, totalDays)
				dailyRawLoc[day][chosen.Idx][locI] += rawActive
				for h := h0; h < h1x; h++ {
					tj := timeCategoryForHour(h, simZ)
					dailyRawTime[day][chosen.Idx][tj] += 1.0
				}
				spanB0 := LinearBusySpanCalendarBlock(day, B, L0)
				newAssignments = append(newAssignments, &AssignmentRecord{
					Day: planDay, CalendarBlock: spanB0, StartHour: BlockStartHour(planDayStartHour, spanB0, sh), Slot: sidx,
					SoldierIdx: chosen.Idx, LocI: locI, TimeJ: timeCategoryForHour(h0, simZ),
					Weight: bestTotW, RawHours: rawActive, Kind: "windowed", Rowspan: rowspan,
					WinStartBlock: b0, WinEndBlock: b1, WindowName: bestWname, LinearBusySpanBlocks: span,
				})
			}
		}
	}
	} // skipNonrotExtend

	// --- rotating (DFS on non-rotating busy, then replay prefix rot before suffix fill) ---
	rotIdx = rotatingSlotIndices(slotPatterns)
	capOneRotatingPerDay := zoneHasMultipleRotatingTypes(zone, rotIdx)
	dfsRotOk := false
	dfsExcl, dfsMayRun := zone.rotatingDfsTypeExclude(rotIdx)
	if dfsMayRun && xCool > 0 && len(rotIdx) > 0 &&
		nChooseK(numSoldiers, len(rotIdx)) <= maxRotatingDfsCombinations {
		dr := new3DBool(totalDays, numSoldiers, blocksPd)
		copy3D(dr, busyRot)
		nodes := 0
		if dfsRotatingOnlyMask(dr, busy, soldiers, 0, totalDays, blocksPd, len(rotIdx), kRestMask, maxConsecutiveDutyBlocks, xCool, extendAvail, planDayStartHour, sh, typeCodes, dfsExcl, capOneRotatingPerDay, &nodes) {
			copy3D(busyRot, dr)
			dfsRotOk = true
			if len(rotPrefixReplay) > 0 {
				if err := ReplayPrefixAssignments(zone, soldiers, busy, busyRot, dailyRawLoc, dailyRawTime,
					rotPrefixReplay, totalDays, blocksPd, planDayStartHour); err != nil {
					return nil, nil, err
				}
			}
			for day := dayStart; day < dayEnd; day++ {
				planDay := day - prefixDays
				for b := 0; b < blocksPd; b++ {
					startH := BlockStartHour(planDayStartHour, b, sh)
					timeJ := timeCategoryForHour(startH, simZ)
					tw := zone.TimeBands[timeJ].Weight
					var inBlock []*Soldier
					for _, s := range soldiers {
						if dr[day][s.Idx][b] {
							inBlock = append(inBlock, s)
						}
					}
					var assigned []*Soldier
					clear2D(deltasLoc)
					clear2D(deltasTime)
					clear1D(deltasG)
					var rotPf prefixFn
					if xCool > 0 {
						rotPf = rotatingPrefixKey(busy, busyRot, day, b, blocksPd, totalDays, kRestMask)
					}
					for _, sidx := range rotIdx {
						if slotDisabledForDay(zone, sidx, planDay, planDayStartHour, anchor) {
							continue
						}
						locI := zone.Slots[sidx].LocationIndex
						lw := zone.Locations[locI].Weight
						weight := sh * lw * tw
						nReq := zone.Slots[sidx].SoldiersRequired
						excl := zone.slotTypeExclude(locI)
						poolFn := func(already []*Soldier) []*Soldier {
							var pool []*Soldier
							for _, s := range inBlock {
								if containsSoldier(already, s) || containsSoldier(assigned, s) {
									continue
								}
								if soldierExcludedByType(typeCodes, s.Idx, excl) {
									continue
								}
								pool = append(pool, s)
							}
							return pool
						}
						chosenList, err := pickSoldiersForRotatingSlot(
							nReq, poolFn, locI, timeJ, deltasLoc, deltasTime, deltasG, r,
							bandRelative, balanceTotalHours, totalHoursSlack, rotPf,
						)
						if err != nil {
							return nil, nil, fmt.Errorf("%w: rotating DFS (extend) day %d block %d slot %d: %v",
								ErrRestConstraint, planDay+1, b+1, sidx+1, err)
						}
						for _, chosen := range chosenList {
							assigned = append(assigned, chosen)
							chosen.addAssignment(locI, timeJ, weight, sh)
							busy[day][chosen.Idx][b] = true
							dailyRawLoc[day][chosen.Idx][locI] += sh
							dailyRawTime[day][chosen.Idx][timeJ] += sh
							deltasLoc[chosen.Idx][locI] += weight
							deltasTime[chosen.Idx][timeJ] += weight
							deltasG[chosen.Idx] += weight
							newAssignments = append(newAssignments, &AssignmentRecord{
								Day: day, CalendarBlock: b, StartHour: startH, Slot: sidx, SoldierIdx: chosen.Idx,
								LocI: locI, TimeJ: timeJ, Weight: weight, RawHours: sh, Kind: "rotating",
								Rowspan: 1, WinStartBlock: b, WinEndBlock: b,
							})
						}
					}
				}
			}
		}
	}
	if !dfsRotOk {
		if len(rotPrefixReplay) > 0 {
			if err := ReplayPrefixAssignments(zone, soldiers, busy, busyRot, dailyRawLoc, dailyRawTime,
				rotPrefixReplay, totalDays, blocksPd, planDayStartHour); err != nil {
				return nil, nil, err
			}
		}
		for day := dayStart; day < dayEnd; day++ {
			planDay := day - prefixDays
			for b := 0; b < blocksPd; b++ {
				startH := BlockStartHour(planDayStartHour, b, sh)
				timeJ := timeCategoryForHour(startH, simZ)
				tw := zone.TimeBands[timeJ].Weight
				var assigned []*Soldier
				clear2D(deltasLoc)
				clear2D(deltasTime)
				clear1D(deltasG)
				var rotPf prefixFn
				if xCool > 0 {
					rotPf = rotatingPrefixKey(busy, busyRot, day, b, blocksPd, totalDays, kRestMask)
				}
				for sidx := 0; sidx < slotsPerBlock; sidx++ {
					if zone.Slots[sidx].Pattern != "rotating" {
						continue
					}
					if slotDisabledForDay(zone, sidx, planDay, planDayStartHour, anchor) {
						continue
					}
					locI := zone.Slots[sidx].LocationIndex
					lw := zone.Locations[locI].Weight
					weight := sh * lw * tw
					nReq := zone.Slots[sidx].SoldiersRequired
					excl := zone.slotTypeExclude(locI)
					poolFn := func(already []*Soldier) []*Soldier {
						var base []*Soldier
						for _, s := range soldiers {
							if containsSoldier(assigned, s) || containsSoldier(already, s) {
								continue
							}
							if soldierExcludedByType(typeCodes, s.Idx, excl) {
								continue
							}
							if soldierMustRestThisBlock(s.Idx, day, b, blocksPd, kRestMask) {
								continue
							}
							if busy[day][s.Idx][b] {
								continue
							}
							if maxConsecutiveDutyBlocks > 0 &&
								consecutiveDutyBlocksBefore(busyRot, day, b, s.Idx, blocksPd) >= maxConsecutiveDutyBlocks {
								continue
							}
							if extendAvail != nil && !soldierAvail(extendAvail, s.Idx, day, func() bool {
								return extendAvail.AvailRotatingBlock(s.Idx, day, b, planDayStartHour, sh)
							}) {
								continue
							}
							base = append(base, s)
						}
						pool := base
						if xCool > 0 {
							stats.ShiftCooldownPoolIterations++
							var filt []*Soldier
							for _, s := range base {
								gap := gapFreeBlocksSinceLastDutyBeforeAssign(busyRot, day, b, s.Idx, blocksPd)
								if gap >= xCool || gap >= largeLinearGap {
									filt = append(filt, s)
								} else {
									stats.ShiftCooldownExclusions++
								}
							}
							pool = filt
						}
						if capOneRotatingPerDay {
							pool = filterRotatingPoolOnePerDay(pool, busyRot, day, blocksPd)
						}
						return pool
					}
					chosenList, err := pickSoldiersForRotatingSlot(
						nReq, poolFn, locI, timeJ, deltasLoc, deltasTime, deltasG, r,
						bandRelative, balanceTotalHours, totalHoursSlack, rotPf,
					)
					if err != nil {
						return nil, nil, fmt.Errorf("%w: rotating (extend) cannot fill day %d block %d slot %d: %v",
							ErrRestConstraint, planDay+1, b+1, sidx+1, err)
					}
					for _, chosen := range chosenList {
						assigned = append(assigned, chosen)
						chosen.addAssignment(locI, timeJ, weight, sh)
						busy[day][chosen.Idx][b] = true
						busyRot[day][chosen.Idx][b] = true
						dailyRawLoc[day][chosen.Idx][locI] += sh
						dailyRawTime[day][chosen.Idx][timeJ] += sh
						deltasLoc[chosen.Idx][locI] += weight
						deltasTime[chosen.Idx][timeJ] += weight
						deltasG[chosen.Idx] += weight
						newAssignments = append(newAssignments, &AssignmentRecord{
							Day: day, CalendarBlock: b, StartHour: startH, Slot: sidx, SoldierIdx: chosen.Idx,
							LocI: locI, TimeJ: timeJ, Weight: weight, RawHours: sh, Kind: "rotating",
							Rowspan: 1, WinStartBlock: b, WinEndBlock: b,
						})
					}
				}
			}
		}
	}

	maxFree := computeMaxConsecutiveFreeHours(busy, sh)
	normNew := normalizeExtendNewRecords(newAssignments, prefixDays)
	validateAsn := normNew
	if witness != nil {
		validateAsn = make([]*AssignmentRecord, 0, len(prefixAssignments)+len(witness.SuffixNonrot)+len(normNew))
		validateAsn = append(validateAsn, prefixAssignments...)
		validateAsn = append(validateAsn, witness.SuffixNonrot...)
		validateAsn = append(validateAsn, normNew...)
	}
	if err := validateScheduleRest(maxFree, minConsecutiveFreeHours, validateAsn); err != nil {
		return nil, nil, err
	}
	if err := validateMaxConsecutiveDuty(busyRot, maxConsecutiveDutyBlocks); err != nil {
		return nil, nil, err
	}
	stats.ShiftCooldownViolationsPost = countShiftCooldownViolations(busyRot, xCool)
	if stats.ShiftCooldownViolationsPost > 0 {
		return nil, nil, fmt.Errorf("%w: internal shift-cooldown violations: %d", ErrRestConstraint, stats.ShiftCooldownViolationsPost)
	}
	return newAssignments, stats, nil
}

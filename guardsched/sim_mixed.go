package guardsched

import (
	"fmt"
	"math"
)

// RunSimulationZoneConfig runs the mixed-pattern scheduler (full_day → windowed → rotating).
func RunSimulationZoneConfig(
	zone *ZoneConfig,
	numSoldiers, days int,
	r *PyRandom,
	minConsecutiveFreeHours float64,
	balanceTotalHours bool,
	totalHoursSlack float64,
	maxConsecutiveDutyBlocks int,
	minFreeShiftsAfterDuty int,
	bandRelative float64,
	planDayStartHour int,
	avail AvailabilityChecker,
) ([]*AssignmentRecord, *SimulationStats, error) {
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
	simZ := zone.ToZone()
	nl := len(zone.Locations)
	nt := len(zone.TimeBands)
	soldiers := make([]*Soldier, numSoldiers)
	for i := range soldiers {
		soldiers[i] = makeSoldier(i, 0, nl, nt)
	}
	for day := 0; day < days; day++ {
		for i := range soldiers {
			var add float64
			if avail == nil {
				add = 24.0
			} else {
				bh, ah := availFairnessHours(avail, i, day)
				add = bh + ah
			}
			soldiers[i].AvailableHours += add
		}
	}
	busy := new3DBool(days, numSoldiers, blocksPd)
	busyRot := new3DBool(days, numSoldiers, blocksPd)
	dailyRawLoc := new3DFloat(days, numSoldiers, nl)
	dailyRawTime := new3DFloat(days, numSoldiers, nt)
	deltasLoc := new2DFloat(numSoldiers, nl)
	deltasTime := new2DFloat(numSoldiers, nt)
	deltasG := make([]float64, numSoldiers)
	var assignments []*AssignmentRecord
	kRest := consecutiveFreeBlocksNeeded(sh, minConsecutiveFreeHours)
	stats := &SimulationStats{}
	xCool := minFreeShiftsAfterDuty
	if xCool > 0 && minConsecutiveFreeHours > 0 && float64(xCool)*sh+1e-9 >= minConsecutiveFreeHours && nRot == slotsPerBlock {
		kRest = 0
	}

	// --- full_day ---
	for day := 0; day < days; day++ {
		clear2D(deltasLoc)
		clear1D(deltasG)
		clear2D(deltasTime)
		for sidx := 0; sidx < slotsPerBlock; sidx++ {
			if zone.Slots[sidx].Pattern != "full_day" {
				continue
			}
			locI := zone.Slots[sidx].LocationIndex
			tid := zone.Locations[locI].TypeID
			cfg := zone.FullDaySpecs[tid]
			sh0, sh1 := cfg.StartH, cfg.EndH
			L0, span := linearBusySpanDutyHoursPlusRest(day, B, sh, sh0, sh1, false, cfg.RestAfterH)
			lw := zone.Locations[locI].Weight
			wm := cfg.WeightMult
			rawActive := float64(sh1 - sh0 + 1)
			b0, b1 := dutyBlocksInclusiveWallHours(sh, sh0, sh1)
			dutyW := b1 - b0 + 1
			var pool []*Soldier
			for _, s := range soldiers {
				if !anyBusySpan(busy, s.Idx, L0, span, B, days) &&
					soldierAvail(avail, s.Idx, day, func() bool {
						return avail.AvailDutyWallHours(s.Idx, day, sh0, sh1+1)
					}) {
					pool = append(pool, s)
				}
			}
			if len(pool) == 0 {
				return nil, nil, fmt.Errorf("%w: full_day cannot fill day %d slot %d", ErrRestConstraint, day+1, sidx+1)
			}
			clear2D(deltasLoc)
			clear2D(deltasTime)
			clear1D(deltasG)
			timeMid := timeCategoryForHour((sh0+sh1)/2, simZ)
			chosen := pickSoldier(pool, locI, timeMid, deltasLoc, deltasTime, deltasG, r, bandRelative, balanceTotalHours, totalHoursSlack, nil)
			totW := 0.0
			for h := sh0; h <= sh1; h++ {
				tj := timeCategoryForHour(h, simZ)
				tw := zone.TimeBands[tj].Weight
				wpart := lw * tw * wm
				totW += wpart
				chosen.addAssignment(locI, tj, wpart, 1.0)
			}
			busySpanSet(busy, chosen.Idx, L0, span, B, days)
			dailyRawLoc[day][chosen.Idx][locI] += rawActive
			for h := sh0; h <= sh1; h++ {
				tj := timeCategoryForHour(h, simZ)
				dailyRawTime[day][chosen.Idx][tj] += 1.0
			}
			assignments = append(assignments, &AssignmentRecord{
				Day: day, CalendarBlock: b0, StartHour: int(float64(b0) * sh), Slot: sidx,
				SoldierIdx: chosen.Idx, LocI: locI, TimeJ: timeMid, Weight: totW, RawHours: rawActive,
				Kind: "full_day", Rowspan: dutyW, WinStartBlock: b0, WinEndBlock: b1,
				LinearBusySpanBlocks: span,
			})
		}
	}

	// --- windowed ---
	for day := 0; day < days; day++ {
		clear2D(deltasLoc)
		clear2D(deltasTime)
		clear1D(deltasG)
		for sidx := 0; sidx < slotsPerBlock; sidx++ {
			if zone.Slots[sidx].Pattern != "windowed_slots" {
				continue
			}
			locI := zone.Slots[sidx].LocationIndex
			tid := zone.Locations[locI].TypeID
			wins := zone.WindowedSpecs[tid]
			restH := zone.WindowedRestHours[tid]
			lw := zone.Locations[locI].Weight
			var bestKey []float64
			var bestWI int
			var bestSol *Soldier
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
				L0w, spanw := linearBusySpanDutyHoursPlusRest(day, B, sh, h0, h1x, true, restH)
				var pool []*Soldier
				for _, s := range soldiers {
					if !anyBusySpan(busy, s.Idx, L0w, spanw, B, days) &&
						soldierAvail(avail, s.Idx, day, func() bool {
							return avail.AvailDutyWallHours(s.Idx, day, h0, h1x)
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
					bestSol = cand
					bestWdef = wdef
					bestTotW = totW
					bestWname = wname
					have = true
				}
			}
			if !have {
				return nil, nil, fmt.Errorf("%w: windowed cannot fill day %d slot %d", ErrRestConstraint, day+1, sidx+1)
			}
			chosen := bestSol
			wdef := bestWdef
			h0, h1x := wdef.H0, wdef.H1Excl
			wm := wdef.WeightMult
			rawActive := float64(max(0, h1x-h0))
			L0, span := linearBusySpanDutyHoursPlusRest(day, B, sh, h0, h1x, true, restH)
			for h := h0; h < h1x; h++ {
				tj := timeCategoryForHour(h, simZ)
				tw := zone.TimeBands[tj].Weight
				wpart := lw * tw * wm
				chosen.addAssignment(locI, tj, wpart, 1.0)
			}
			busySpanSet(busy, chosen.Idx, L0, span, B, days)
			dailyRawLoc[day][chosen.Idx][locI] += rawActive
			for h := h0; h < h1x; h++ {
				tj := timeCategoryForHour(h, simZ)
				dailyRawTime[day][chosen.Idx][tj] += 1.0
			}
			b0, b1 := dutyBlocksHalfOpenWallHours(sh, h0, h1x)
			rowspan := max(1, b1-b0+1)
			assignments = append(assignments, &AssignmentRecord{
				Day: day, CalendarBlock: b0, StartHour: int(float64(b0) * sh), Slot: sidx,
				SoldierIdx: chosen.Idx, LocI: locI, TimeJ: timeCategoryForHour(h0, simZ),
				Weight: bestTotW, RawHours: rawActive, Kind: "windowed", Rowspan: rowspan,
				WinStartBlock: b0, WinEndBlock: b1, WindowName: bestWname, LinearBusySpanBlocks: span,
			})
		}
	}

	rotIdx := rotatingSlotIndices(slotPatterns)
	dfsRotOk := false
	rotatingDfsTried := false
	if xCool > 0 && len(rotIdx) == slotsPerBlock && len(rotIdx) > 0 &&
		nChooseK(numSoldiers, len(rotIdx)) <= maxRotatingDfsCombinations {
		rotatingDfsTried = true
		dr := new3DBool(days, numSoldiers, blocksPd)
		nodes := 0
		if dfsRotatingOnlyMask(dr, busy, soldiers, 0, days, blocksPd, len(rotIdx), kRest, maxConsecutiveDutyBlocks, xCool, avail, planDayStartHour, sh, &nodes) {
			copy3D(busyRot, dr)
			dfsRotOk = true
			for day := 0; day < days; day++ {
				for b := 0; b < blocksPd; b++ {
					// Rotating grid: blocks align to plan-day start; full_day/windowed use YAML wall hours.
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
						rotPf = rotatingPrefixKey(busy, busyRot, day, b, blocksPd, days, kRest)
					}
					for _, sidx := range rotIdx {
						locI := zone.Slots[sidx].LocationIndex
						lw := zone.Locations[locI].Weight
						weight := sh * lw * tw
						var pool []*Soldier
						for _, s := range inBlock {
							if !containsSoldier(assigned, s) {
								pool = append(pool, s)
							}
						}
						if len(pool) == 0 {
							return nil, nil, fmt.Errorf("%w: rotating DFS fill empty pool day %d block %d", ErrRestConstraint, day+1, b+1)
						}
						chosen := pickSoldier(pool, locI, timeJ, deltasLoc, deltasTime, deltasG, r, bandRelative, balanceTotalHours, totalHoursSlack, rotPf)
						assigned = append(assigned, chosen)
						chosen.addAssignment(locI, timeJ, weight, sh)
						busy[day][chosen.Idx][b] = true
						dailyRawLoc[day][chosen.Idx][locI] += sh
						dailyRawTime[day][chosen.Idx][timeJ] += sh
						deltasLoc[chosen.Idx][locI] += weight
						deltasTime[chosen.Idx][timeJ] += weight
						deltasG[chosen.Idx] += weight
						assignments = append(assignments, &AssignmentRecord{
							Day: day, CalendarBlock: b, StartHour: startH, Slot: sidx, SoldierIdx: chosen.Idx,
							LocI: locI, TimeJ: timeJ, Weight: weight, RawHours: sh, Kind: "rotating",
							Rowspan: 1, WinStartBlock: b, WinEndBlock: b,
						})
					}
				}
			}
		}
	}

	if !dfsRotOk {
		for day := 0; day < days; day++ {
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
					rotPf = rotatingPrefixKey(busy, busyRot, day, b, blocksPd, days, kRest)
				}
				for sidx := 0; sidx < slotsPerBlock; sidx++ {
					if zone.Slots[sidx].Pattern != "rotating" {
						continue
					}
					locI := zone.Slots[sidx].LocationIndex
					lw := zone.Locations[locI].Weight
					weight := sh * lw * tw
					var base []*Soldier
					for _, s := range soldiers {
						if containsSoldier(assigned, s) {
							continue
						}
						if soldierMustRestThisBlock(s.Idx, day, b, blocksPd, kRest) {
							continue
						}
						if busy[day][s.Idx][b] {
							continue
						}
						if maxConsecutiveDutyBlocks > 0 &&
							consecutiveDutyBlocksBefore(busyRot, day, b, s.Idx, blocksPd) >= maxConsecutiveDutyBlocks {
							continue
						}
						if !soldierAvail(avail, s.Idx, day, func() bool {
							return avail.AvailRotatingBlock(s.Idx, day, b, planDayStartHour, sh)
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
					if len(pool) == 0 {
						extra := ""
						if rotatingDfsTried && !dfsRotOk {
							extra = " (all-rotating DFS found no feasible mask)"
						}
						return nil, nil, fmt.Errorf("%w: rotating cannot fill day %d block %d slot %d%s", ErrRestConstraint, day+1, b+1, sidx+1, extra)
					}
					chosen := pickSoldier(pool, locI, timeJ, deltasLoc, deltasTime, deltasG, r, bandRelative, balanceTotalHours, totalHoursSlack, rotPf)
					assigned = append(assigned, chosen)
					chosen.addAssignment(locI, timeJ, weight, sh)
					busy[day][chosen.Idx][b] = true
					busyRot[day][chosen.Idx][b] = true
					dailyRawLoc[day][chosen.Idx][locI] += sh
					dailyRawTime[day][chosen.Idx][timeJ] += sh
					deltasLoc[chosen.Idx][locI] += weight
					deltasTime[chosen.Idx][timeJ] += weight
					deltasG[chosen.Idx] += weight
					assignments = append(assignments, &AssignmentRecord{
						Day: day, CalendarBlock: b, StartHour: startH, Slot: sidx, SoldierIdx: chosen.Idx,
						LocI: locI, TimeJ: timeJ, Weight: weight, RawHours: sh, Kind: "rotating",
						Rowspan: 1, WinStartBlock: b, WinEndBlock: b,
					})
				}
			}
		}
	}

	maxFree := computeMaxConsecutiveFreeHours(busy, sh)
	if err := validateScheduleRest(maxFree, minConsecutiveFreeHours, assignments); err != nil {
		return nil, nil, err
	}
	if err := validateMaxConsecutiveDuty(busyRot, maxConsecutiveDutyBlocks); err != nil {
		return nil, nil, err
	}
	stats.ShiftCooldownViolationsPost = countShiftCooldownViolations(busyRot, xCool)
	if stats.ShiftCooldownViolationsPost > 0 {
		return nil, nil, fmt.Errorf("%w: internal shift-cooldown violations: %d", ErrRestConstraint, stats.ShiftCooldownViolationsPost)
	}
	_ = dailyRawLoc
	_ = dailyRawTime
	return assignments, stats, nil
}

type fairnessHours interface {
	FairnessHours(idx, day int) (base, away float64)
}

func availFairnessHours(avail AvailabilityChecker, idx, day int) (base, away float64) {
	if fh, ok := avail.(fairnessHours); ok {
		return fh.FairnessHours(idx, day)
	}
	return 24, 0
}

func new3DFloat(d1, d2, d3 int) [][][]float64 {
	o := make([][][]float64, d1)
	for i := range o {
		o[i] = make([][]float64, d2)
		for j := range o[i] {
			o[i][j] = make([]float64, d3)
		}
	}
	return o
}

func floatSliceEqual(a, b []float64) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if math.Abs(a[i]-b[i]) > 1e-12 {
			return false
		}
	}
	return true
}

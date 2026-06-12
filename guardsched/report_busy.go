package guardsched

// BuildBusyTensor marks busy[day][soldier][block] for timeline charts and report parity.
// When includeYamlRest is true, full_day / full_day_team / windowed assignments use the
// linear duty+rest span (LinearBusySpanBlocks + CalendarBlock anchor). Otherwise only
// posted-duty blocks (AssignmentOccupiedBlocks) are set.
func BuildBusyTensor(
	recs []*AssignmentRecord,
	days, numSoldiers, blocksPd int,
	includeYamlRest bool,
) [][][]bool {
	busy := new3DBool(days, numSoldiers, blocksPd)
	maxL := days * blocksPd
	for _, a := range recs {
		if a == nil {
			continue
		}
		if includeYamlRest && a.LinearBusySpanBlocks > 0 {
			L0 := a.Day*blocksPd + a.CalendarBlock
			for k := 0; k < a.LinearBusySpanBlocks; k++ {
				L := L0 + k
				if L >= maxL {
					break
				}
				d, b := L/blocksPd, L%blocksPd
				if d >= 0 && d < days && a.SoldierIdx >= 0 && a.SoldierIdx < numSoldiers && b >= 0 && b < blocksPd {
					busy[d][a.SoldierIdx][b] = true
				}
			}
			continue
		}
		for _, b := range AssignmentOccupiedBlocks(a, blocksPd) {
			if a.Day >= 0 && a.Day < days && a.SoldierIdx >= 0 && a.SoldierIdx < numSoldiers &&
				b >= 0 && b < blocksPd {
				busy[a.Day][a.SoldierIdx][b] = true
			}
		}
	}
	return busy
}

// IsFullDayTimelineKind reports whether an assignment kind uses orange timeline segments.
func IsFullDayTimelineKind(kind string) bool {
	k := kind
	if k == "" {
		k = "rotating"
	}
	return k == "full_day" || k == "full_day_team"
}

// BuildFullDayDutyTensor marks full_day_busy[day][soldier][block] for timeline orange segments.
// Uses the same span rules as BuildBusyTensor but only for full_day / full_day_team assignments.
func BuildFullDayDutyTensor(
	recs []*AssignmentRecord,
	days, numSoldiers, blocksPd int,
	includeYamlRest bool,
) [][][]bool {
	out := new3DBool(days, numSoldiers, blocksPd)
	maxL := days * blocksPd
	for _, a := range recs {
		if a == nil || !IsFullDayTimelineKind(a.Kind) {
			continue
		}
		if includeYamlRest && a.LinearBusySpanBlocks > 0 {
			L0 := a.Day*blocksPd + a.CalendarBlock
			for k := 0; k < a.LinearBusySpanBlocks; k++ {
				L := L0 + k
				if L >= maxL {
					break
				}
				d, b := L/blocksPd, L%blocksPd
				if d >= 0 && d < days && a.SoldierIdx >= 0 && a.SoldierIdx < numSoldiers && b >= 0 && b < blocksPd {
					out[d][a.SoldierIdx][b] = true
				}
			}
			continue
		}
		for _, b := range AssignmentOccupiedBlocks(a, blocksPd) {
			if a.Day >= 0 && a.Day < days && a.SoldierIdx >= 0 && a.SoldierIdx < numSoldiers &&
				b >= 0 && b < blocksPd {
				out[a.Day][a.SoldierIdx][b] = true
			}
		}
	}
	return out
}

// LinearBusyBlockLookup maps (soldier, day, block) to the assignment whose duty+rest span covers that block.
func LinearBusyBlockLookup(recs []*AssignmentRecord, days, blocksPd int) map[[3]int]*AssignmentRecord {
	out := make(map[[3]int]*AssignmentRecord)
	maxL := days * blocksPd
	for _, a := range recs {
		if a == nil || a.LinearBusySpanBlocks <= 0 {
			continue
		}
		L0 := a.Day*blocksPd + a.CalendarBlock
		for k := 0; k < a.LinearBusySpanBlocks; k++ {
			L := L0 + k
			if L >= maxL {
				break
			}
			d, b := L/blocksPd, L%blocksPd
			out[[3]int{a.SoldierIdx, d, b}] = a
		}
	}
	return out
}

// BusySpanCovered reports whether (soldier, day, block) is in the linear busy span lookup.
func BusySpanCovered(lookup map[[3]int]*AssignmentRecord, soldier, day, block int) bool {
	_, ok := lookup[[3]int{soldier, day, block}]
	return ok
}

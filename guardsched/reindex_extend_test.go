package guardsched

import "testing"

func TestReindexExtendSegmentPreservesNonRotatingPlanDays(t *testing.T) {
	prefixDays := 14
	recs := []*AssignmentRecord{
		{Day: prefixDays, Slot: 0, SoldierIdx: 1, Kind: "rotating"},
		{Day: 0, Slot: 8, SoldierIdx: 2, Kind: "full_day_team"},
		{Day: 0, Slot: 9, SoldierIdx: 3, Kind: "full_day"},
		{Day: 0, Slot: 10, SoldierIdx: 4, Kind: "full_day"},
	}
	out := ReindexExtendSegment(recs, prefixDays)
	got := map[int]int{}
	for _, a := range out {
		if a == nil || a.Day != 0 {
			continue
		}
		got[a.Slot]++
	}
	for _, slot := range []int{0, 8, 9, 10} {
		if got[slot] == 0 {
			t.Fatalf("slot %d missing after reindex; got=%v", slot, got)
		}
	}
}

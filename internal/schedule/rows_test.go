package schedule

import (
	"testing"
	"time"

	"guard/guardsched"
)

func TestToFromScheduleRowsRoundTrip(t *testing.T) {
	anchor := time.Date(2026, 5, 20, 0, 0, 0, 0, time.UTC)
	keys := []string{"s0", "s1", "s2"}
	labels := []string{"Gate A", "Gate B"}
	recs := []*guardsched.AssignmentRecord{
		{
			Day: 0, CalendarBlock: 1, StartHour: 8, Slot: 0, SoldierIdx: 1,
			LocI: 0, TimeJ: 0, Weight: 1, RawHours: 4, Kind: "rotating",
			Rowspan: 1, WinStartBlock: 1, WinEndBlock: 1,
		},
		{
			Day: 1, CalendarBlock: 2, StartHour: 12, Slot: 1, SoldierIdx: 2,
			LocI: 1, TimeJ: 1, Weight: 1.5, RawHours: 4, Kind: "rotating",
			Rowspan: 1, WinStartBlock: 2, WinEndBlock: 2,
		},
	}
	rows, err := ToScheduleRows(PersistInput{
		AnchorDate: anchor, BlockHours: 4, BlocksPerDay: 6,
		SoldierKeys: keys, SlotLabels: labels, Records: recs,
	})
	if err != nil {
		t.Fatal(err)
	}
	back, err := FromScheduleRows(ReverseInput{
		AnchorDate: anchor, BlockHours: 4, SoldierKeys: keys, SlotLabels: labels, Rows: rows,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(back) != len(recs) {
		t.Fatalf("got %d records, want %d", len(back), len(recs))
	}
	for i, want := range recs {
		got := back[i]
		if got.Day != want.Day || got.CalendarBlock != want.CalendarBlock || got.SoldierIdx != want.SoldierIdx {
			t.Fatalf("record %d: %+v vs want %+v", i, got, want)
		}
		if got.Slot != want.Slot {
			t.Fatalf("record %d slot %d want %d", i, got.Slot, want.Slot)
		}
		if got.Rowspan != want.Rowspan || got.WinStartBlock != want.WinStartBlock || got.WinEndBlock != want.WinEndBlock {
			t.Fatalf("record %d meta: rowspan/win blocks %+v vs want rowspan=%d win=%d..%d",
				i, got, want.Rowspan, want.WinStartBlock, want.WinEndBlock)
		}
	}
}

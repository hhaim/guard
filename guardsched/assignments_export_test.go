package guardsched

import (
	"sort"
	"testing"
)

// checkpointAssignmentKeys are the assignment fields persisted in CLI checkpoint JSON
// (Python assignment_record_to_dict). UI/API rows use the same set plus soldier_id.
var checkpointAssignmentKeys = []string{
	"calendar_block",
	"day",
	"kind",
	"linear_busy_span_blocks",
	"loc_i",
	"raw_hours",
	"rowspan",
	"slot",
	"soldier_idx",
	"start_hour",
	"time_j",
	"weight",
	"win_end_block",
	"win_start_block",
	"window_name",
}

func TestAssignmentRecordsToJSONUsesCheckpointFieldsPlusSoldierID(t *testing.T) {
	keys := SoldierKeys(4)
	recs := []*AssignmentRecord{{
		Day: 0, CalendarBlock: 1, StartHour: 8, Slot: 0, SoldierIdx: 2,
		LocI: 1, TimeJ: 0, Weight: 4.5, RawHours: 4, Kind: "rotating",
		Rowspan: 1, WinStartBlock: 1, WinEndBlock: 1,
		WindowName: "morning", LinearBusySpanBlocks: 3,
	}}
	out := AssignmentRecordsToJSON(recs, keys)
	if len(out) != 1 {
		t.Fatalf("got %d rows", len(out))
	}
	gotKeys := sortedKeys(out[0])
	want := append([]string(nil), checkpointAssignmentKeys...)
	want = append(want, "soldier_id")
	sort.Strings(want)
	if len(gotKeys) != len(want) {
		t.Fatalf("keys: got %v want %v", gotKeys, want)
	}
	for i := range want {
		if gotKeys[i] != want[i] {
			t.Fatalf("keys: got %v want %v", gotKeys, want)
		}
	}
	if out[0]["soldier_id"] != "s2" {
		t.Fatalf("soldier_id: got %v", out[0]["soldier_id"])
	}
}

func sortedKeys(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

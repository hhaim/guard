package guardsched

import "testing"

func TestRecordsFromAssignmentJSON_soldierID(t *testing.T) {
	keys := []string{"a", "b"}
	assigns := []map[string]any{
		{"day": 0, "calendar_block": 1, "start_hour": 8, "slot": 0, "soldier_id": "b", "kind": "rotating"},
	}
	recs := RecordsFromAssignmentJSON(assigns, keys)
	if len(recs) != 1 || recs[0].SoldierIdx != 1 {
		t.Fatalf("got %+v", recs)
	}
}

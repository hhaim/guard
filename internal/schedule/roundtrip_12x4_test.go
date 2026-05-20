package schedule

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"

	"guard/guardsched"
)

type samplePlanDoc struct {
	AnchorDate  string           `json:"anchor_date"`
	Days        int              `json:"days"`
	ShiftHours  float64          `json:"shift_hours"`
	SoldierKeys []string         `json:"soldier_keys"`
	SlotLabels  []string         `json:"slot_labels"`
	Assignments []map[string]any `json:"assignments"`
}

func samplePlanPath() string {
	return filepath.Join("..", "..", "testdata", "sample_plan_12x4.json")
}

func loadSamplePlan12x4(t *testing.T) samplePlanDoc {
	t.Helper()
	raw, err := os.ReadFile(samplePlanPath())
	if err != nil {
		t.Fatalf("read sample: %v", err)
	}
	var doc samplePlanDoc
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse sample: %v", err)
	}
	if len(doc.SoldierKeys) != 12 {
		t.Fatalf("want 12 soldiers, got %d", len(doc.SoldierKeys))
	}
	if len(doc.SlotLabels) != 4 {
		t.Fatalf("want 4 slot labels, got %d", len(doc.SlotLabels))
	}
	if len(doc.Assignments) != 24 {
		t.Fatalf("want 24 assignments (6 blocks × 4 slots), got %d", len(doc.Assignments))
	}
	return doc
}

func assignmentLess(a, b map[string]any) bool {
	key := func(m map[string]any) string {
		return fmt.Sprintf("%d:%d:%d:%d",
			intVal(m["day"]), intVal(m["calendar_block"]), intVal(m["slot"]), intVal(m["soldier_idx"]))
	}
	return key(a) < key(b)
}

func intVal(v any) int {
	switch x := v.(type) {
	case float64:
		return int(x)
	case int:
		return x
	default:
		return 0
	}
}

// stripSoldierID removes fields not stored in DB meta (plan JSON may omit soldier_id).
func normalizeAssignments(assigns []map[string]any) []map[string]any {
	out := make([]map[string]any, len(assigns))
	for i, m := range assigns {
		cp := make(map[string]any, len(m))
		for k, v := range m {
			if k == "soldier_id" {
				continue
			}
			cp[k] = v
		}
		if cp["kind"] == nil || cp["kind"] == "" {
			cp["kind"] = "rotating"
		}
		if intVal(cp["rowspan"]) == 0 {
			cp["rowspan"] = 1
		}
		out[i] = cp
	}
	sort.Slice(out, func(i, j int) bool { return assignmentLess(out[i], out[j]) })
	return out
}

func assignmentsEqual(t *testing.T, want, got []map[string]any) {
	t.Helper()
	w := normalizeAssignments(want)
	g := normalizeAssignments(got)
	wb, _ := json.Marshal(w)
	gb, _ := json.Marshal(g)
	if string(wb) != string(gb) {
		t.Fatalf("assignments differ after JSON→DB→JSON round-trip\nwant: %s\ngot:  %s", wb, gb)
	}
}

// JSON (plan) → DB schedule rows → JSON must match for 12 soldiers × 4 slots.
func TestSamplePlan12x4_JSON_DB_JSON_RoundTrip(t *testing.T) {
	doc := loadSamplePlan12x4(t)
	anchor, err := time.Parse("2006-01-02", doc.AnchorDate)
	if err != nil {
		t.Fatal(err)
	}

	recs := guardsched.RecordsFromAssignmentJSON(doc.Assignments, doc.SoldierKeys)
	bp, err := guardsched.CalendarBlocksPerDaySafe(doc.ShiftHours)
	if err != nil {
		t.Fatal(err)
	}

	rows, err := ToScheduleRows(PersistInput{
		AnchorDate: anchor, BlockHours: doc.ShiftHours, BlocksPerDay: bp,
		SoldierKeys: doc.SoldierKeys, SlotLabels: doc.SlotLabels, Records: recs,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 24 {
		t.Fatalf("DB rows: got %d want 24", len(rows))
	}
	slotsSeen := make(map[string]int)
	for _, r := range rows {
		slotsSeen[r.Slot]++
		if r.Slot == "<nil>" || r.Slot == "" {
			t.Fatalf("invalid slot label %q on row shift=%d soldier=%s", r.Slot, r.ShiftIndex, r.SoldierID)
		}
	}
	for _, label := range doc.SlotLabels {
		if slotsSeen[label] != 6 {
			t.Fatalf("slot %q: got %d rows want 6 (one per block)", label, slotsSeen[label])
		}
	}

	back, err := FromScheduleRows(ReverseInput{
		AnchorDate: anchor, BlockHours: doc.ShiftHours,
		SoldierKeys: doc.SoldierKeys, SlotLabels: doc.SlotLabels, Rows: rows,
	})
	if err != nil {
		t.Fatal(err)
	}
	outJSON := guardsched.AssignmentRecordsToJSON(back, doc.SoldierKeys)
	assignmentsEqual(t, doc.Assignments, outJSON)
}

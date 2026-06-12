package model

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func loadSamplePlan(t *testing.T) PlanDoc {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "testdata", "sample_plan_12x4.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		AnchorDate  string           `json:"anchor_date"`
		Days        int              `json:"days"`
		ShiftHours  float64          `json:"shift_hours"`
		Assignments []map[string]any `json:"assignments"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	return PlanDoc{
		FormatVersion: PlanFormatVersion,
		AnchorDate:    doc.AnchorDate,
		Days:          doc.Days,
		ShiftHours:    doc.ShiftHours,
		Assignments:   doc.Assignments,
	}
}

func TestSplitMergeRoundTrip(t *testing.T) {
	src := loadSamplePlan(t)
	days, err := SplitPlanByDate(src)
	if err != nil {
		t.Fatal(err)
	}
	if len(days) != 1 {
		t.Fatalf("want 1 day, got %d", len(days))
	}
	anchor, _ := time.Parse("2006-01-02", src.AnchorDate)
	merged, err := MergeScheduleDays(anchor, days)
	if err != nil {
		t.Fatal(err)
	}
	if len(merged.Assignments) != len(src.Assignments) {
		t.Fatalf("assignments: got %d want %d", len(merged.Assignments), len(src.Assignments))
	}
	wb, _ := json.Marshal(src.Assignments)
	gb, _ := json.Marshal(merged.Assignments)
	if string(wb) != string(gb) {
		t.Fatalf("assignments differ\nwant: %s\ngot:  %s", wb, gb)
	}
}

func TestSplitMultiDayRenumberOnMerge(t *testing.T) {
	anchor := "2026-05-21"
	doc := PlanDoc{
		FormatVersion: PlanFormatVersion,
		AnchorDate:    anchor,
		Days:          2,
		ShiftHours:    4,
		Assignments: []map[string]any{
			{"day": 0, "calendar_block": 0, "soldier_idx": 0},
			{"day": 1, "calendar_block": 0, "soldier_idx": 1},
		},
	}
	days, err := SplitPlanByDate(doc)
	if err != nil {
		t.Fatal(err)
	}
	if len(days) != 2 {
		t.Fatalf("want 2 days, got %d", len(days))
	}
	from, _ := time.Parse("2006-01-02", anchor)
	merged, err := MergeScheduleDays(from, days)
	if err != nil {
		t.Fatal(err)
	}
	if merged.Days != 2 {
		t.Fatalf("days: got %d want 2", merged.Days)
	}
	if intFromAny(merged.Assignments[0]["day"]) != 0 || intFromAny(merged.Assignments[1]["day"]) != 1 {
		t.Fatalf("day renumber: %+v", merged.Assignments)
	}
}

func TestMergeScheduleDaysAnchorFromFirstTsDateNotQueryFrom(t *testing.T) {
	queryFrom, _ := time.Parse("2006-01-02", "2026-05-20")
	d1, _ := time.Parse("2006-01-02", "2026-05-26")
	d2, _ := time.Parse("2006-01-02", "2026-05-27")
	days := []ScheduleDay{
		{
			TsDate: d1,
			Plan: PlanDoc{
				AnchorDate:  "2026-05-26",
				Days:        1,
				ShiftHours:  4,
				Assignments: []map[string]any{{"day": 0, "calendar_block": 0, "soldier_idx": 0}},
				Soldiers: map[string]PlanDaySoldiers{
					"2026-05-26": {AvailFull: []string{"a"}},
				},
				Meta: map[string]any{"plan_day_start": "05:00", "plan_day_start_hour": 5},
			},
		},
		{
			TsDate: d2,
			Plan: PlanDoc{
				AnchorDate:  "2026-05-27",
				Days:        1,
				ShiftHours:  4,
				Assignments: []map[string]any{{"day": 0, "calendar_block": 1, "soldier_idx": 1}},
			},
		},
	}
	merged, err := MergeScheduleDays(queryFrom, days)
	if err != nil {
		t.Fatal(err)
	}
	if merged.AnchorDate != "2026-05-26" {
		t.Fatalf("anchor_date: got %q want 2026-05-26", merged.AnchorDate)
	}
	if merged.Days != 2 {
		t.Fatalf("days: got %d want 2", merged.Days)
	}
	vd, ok := merged.Meta["verified_dates"].([]string)
	if !ok {
		// JSON decode in tests uses []any from round-trip; check via fmt
		raw, _ := json.Marshal(merged.Meta["verified_dates"])
		if string(raw) != `["2026-05-26","2026-05-27"]` {
			t.Fatalf("verified_dates: %v", merged.Meta["verified_dates"])
		}
	} else if len(vd) != 2 || vd[0] != "2026-05-26" || vd[1] != "2026-05-27" {
		t.Fatalf("verified_dates: %v", vd)
	}
	if merged.Soldiers == nil || len(merged.Soldiers["2026-05-26"].AvailFull) != 1 {
		t.Fatalf("soldiers merge: %+v", merged.Soldiers)
	}
}

package guardsched

import (
	"testing"
	"time"
)

func TestRunSimulation_disabledWeekdays(t *testing.T) {
	raw := []byte(`
schema_version: 2
shift_hours: 3
slots_types:
  - id: gate_fd
    pattern: full_day
    disabled_weekdays: [friday]
    config:
      start: "08:00"
      end: "12:00"
      rest_after_hours: 6
zone_loc:
  - { id: loc_gate, type: gate_fd, name: gate, weight: 1.0 }
slots:
  - { location_id: loc_gate, name: g1 }
time_zones:
  - { id: all, name: All, weight: 1.0, from_hour: 0, to_hour: "24:00" }
`)
	zc, err := LoadZoneConfigYAML(raw, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	// Anchor Friday 2026-05-29 → plan day 0 is Friday (disabled)
	anchor := time.Date(2026, 5, 29, 0, 0, 0, 0, time.UTC)
	if WeekdayForAnchorPlanDay(anchor, 0) != 5 {
		t.Fatalf("anchor weekday sanity: got %d want Friday(5)", WeekdayForAnchorPlanDay(anchor, 0))
	}
	r := NewPyRandom(1)
	recs, _, err := RunSimulationZoneConfig(
		zc, 8, 2, r, 6, true, 0, 2, 0, 0.2, 0, nil, &anchor, nil, nil, nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range recs {
		if a.Day == 0 {
			t.Fatalf("expected no assignments on disabled Friday, got %+v", a)
		}
	}
	if len(recs) != 1 {
		t.Fatalf("assignments=%d want 1 (Saturday only)", len(recs))
	}
}

func TestRunSimulation_disabledWeekdaysPlanDayStartFridaySpan(t *testing.T) {
	// Plan day 0 runs Fri 05:00 → Sat 05:00 (two calendar dates). Disabled Saturday must not
	// remove assignments when the shift starts on Friday at plan day start.
	raw := []byte(`
schema_version: 2
shift_hours: 4
slots_types:
  - id: kitchen
    pattern: full_day_team
    disabled_weekdays: [saturday]
    config:
      start: "05:00"
      end: "22:00"
      rest_after_hours: 6
      headcount: 1
      type_quotas: { A: 1 }
zone_loc:
  - { id: loc_k, type: kitchen, name: kitchen, weight: 1.0 }
slots:
  - { location_id: loc_k, name: k1 }
time_zones:
  - { id: all, name: All, weight: 1.0, from_hour: 0, to_hour: "24:00" }
`)
	zc, err := LoadZoneConfigYAML(raw, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	anchor := time.Date(2026, 5, 29, 0, 0, 0, 0, time.UTC) // Friday calendar date
	if WeekdayAtPlanDayStart(anchor, 0, 5) != 5 {
		t.Fatalf("sanity: plan day 0 start weekday want Friday")
	}
	r := NewPyRandom(2)
	recs, _, err := RunSimulationZoneConfig(
		zc, 4, 2, r, 6, true, 0, 2, 0, 0.2, 5, nil, &anchor, []string{"A"}, nil, nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range recs {
		if a.Day == 0 && a.Kind == "full_day_team" {
			return // Friday-started plan day filled despite Saturday wall hours inside span
		}
	}
	t.Fatalf("expected full_day_team on plan day 0 (Friday start), got %v", recs)
}

func TestRunSimulation_soldiersRequiredRotating(t *testing.T) {
	// minimal rotating yaml inline
	raw := []byte(`
schema_version: 2
shift_hours: 3
slots_types:
  - { id: rot, pattern: rotating }
zone_loc:
  - { id: loc1, type: rot, name: L1, weight: 1.0 }
slots:
  - { location_id: loc1, name: s1, soldiers_required: 2 }
time_zones:
  - { id: all, name: All, weight: 1.0, from_hour: 0, to_hour: "24:00" }
`)
	zc, err := LoadZoneConfigYAML(raw, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if zc.Slots[0].SoldiersRequired != 2 {
		t.Fatalf("soldiers_required=%d want 2", zc.Slots[0].SoldiersRequired)
	}
	r := NewPyRandom(3)
	recs, _, err := RunSimulationZoneConfig(
		zc, 6, 1, r, 6, true, 0, 2, 0, 0.2, 0, nil, nil, nil, nil, nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	B, _ := CalendarBlocksPerDaySafe(zc.ShiftHours)
	want := B * 2
	if len(recs) != want {
		t.Fatalf("assignments=%d want %d (2 soldiers per block)", len(recs), want)
	}
}

package guardsched

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func loadFullDay09Rest4Fixture(t *testing.T) (*ZoneConfig, []string, int) {
	t.Helper()
	root := filepath.Join("..", "testdata", "full_day_09_rest4")
	zraw, err := os.ReadFile(filepath.Join(root, "zones.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	rraw, err := os.ReadFile(filepath.Join(root, "roster.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	zc, err := LoadZoneConfigYAML(zraw, 4, nil)
	if err != nil {
		t.Fatal(err)
	}
	keys := Roster(6)
	typeCodes, err := LoadRosterTypeCodesYAML(rraw, keys)
	if err != nil {
		t.Fatal(err)
	}
	return zc, typeCodes, 6
}

func TestLinearBusySpan_fullDay0909_rest4_planStart5(t *testing.T) {
	// Duty 09:00..09:00 next day (24h) + 4h rest → first free wall hour 13:00 on day after duty start.
	L0, span := linearBusySpanDutyHoursPlusRest(0, 6, 4, 9, 9, false, 4, 5)
	if L0 != 1 || span != 7 {
		t.Fatalf("L0=%d span=%d want L0=1 span=7", L0, span)
	}
}

func TestRunSimulation_fullDay0909_rotatingBlockedUntil13(t *testing.T) {
	zc, typeCodes, n := loadFullDay09Rest4Fixture(t)
	planStart := 5
	anchor := time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)
	r := NewPyRandom(7)
	recs, _, err := RunSimulationZoneConfig(
		zc, n, 2, r, 0, true, 0, 0, 0, 0.2, planStart, nil, &anchor, typeCodes, nil, nil, nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	const postSlot = 3 // loc_post is slot index 3 (0-based)
	var fullDaySoldier int = -1
	for _, a := range recs {
		if a.Day == 0 && a.Slot == postSlot && a.Kind == "full_day" {
			fullDaySoldier = a.SoldierIdx
			break
		}
	}
	if fullDaySoldier < 0 {
		t.Fatal("no full_day assignment on day 0")
	}
	// Plan day blocks 0–1 are 05:00–09:00 and 09:00–13:00; rest ends at 13:00 same calendar day.
	for _, a := range recs {
		if a.Day != 1 || a.Kind != "rotating" || a.SoldierIdx != fullDaySoldier {
			continue
		}
		if a.CalendarBlock < 2 {
			startH := BlockStartHour(planStart, a.CalendarBlock, zc.ShiftHours)
			t.Fatalf("soldier %d rotating on day 1 block %d start %02d:00 before 13:00 (rest_after 4h after 24h duty)",
				fullDaySoldier, a.CalendarBlock, startH)
		}
	}
	// Sanity: someone rotates at 13:00 on day 1 so the pool is not empty.
	var saw13 bool
	for _, a := range recs {
		if a.Day == 1 && a.Kind == "rotating" && BlockStartHour(planStart, a.CalendarBlock, zc.ShiftHours) == 13 {
			saw13 = true
			break
		}
	}
	if !saw13 {
		t.Fatal("expected rotating assignments at 13:00 on day 1")
	}
}

func TestRunSimulationExtend_fullDay0909_rotatingBlockedUntil13(t *testing.T) {
	zc, typeCodes, n := loadFullDay09Rest4Fixture(t)
	planStart := 5
	anchor := time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)
	const split = 1
	witness := &SimWitness{SplitDay: split}
	r0 := NewPyRandom(7)
	cold, _, err := RunSimulationZoneConfig(
		zc, n, 2, r0, 0, true, 0, 0, 0, 0.2, planStart, nil, &anchor, typeCodes, nil, witness, nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !witness.Captured {
		t.Fatal("witness not captured at split")
	}
	prefix := filterDayLess(cold, split)
	extWitness := &ExtendWitness{
		RNGVersion: witness.RNGVersion, RNGState: witness.RNGState,
		SuffixNonrot: SuffixNonrotFromRecords(cold, split),
	}
	r1 := NewPyRandom(7)
	extended, _, err := RunSimulationZoneConfigExtend(
		zc, n, split, 1, prefix, r1, 0, true, 0, 0, 0, 0.2, planStart, nil, &anchor, typeCodes, nil, extWitness,
	)
	if err != nil {
		t.Fatal(err)
	}
	const postSlot = 3
	fullDaySoldier := -1
	for _, a := range prefix {
		if a.Slot == postSlot && a.Kind == "full_day" {
			fullDaySoldier = a.SoldierIdx
			break
		}
	}
	if fullDaySoldier < 0 {
		t.Fatal("no full_day on prefix day 0")
	}
	// Extend returns new segment reindexed to day 0 (= calendar day 1).
	for _, a := range extended {
		if a.Day != 0 || a.Kind != "rotating" || a.SoldierIdx != fullDaySoldier {
			continue
		}
		if a.CalendarBlock < 2 {
			startH := BlockStartHour(planStart, a.CalendarBlock, zc.ShiftHours)
			t.Fatalf("extend: soldier %d rotating day 1 block %d at %02d:00 before 13:00",
				fullDaySoldier, a.CalendarBlock, startH)
		}
	}
}

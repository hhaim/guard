package guardsched

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Regression: zones_next_day_full.yaml uses full_day 09:00–09:00 + 4h rest on loc_kitchen.
// Soldier on that post day D must not rotate before 13:00 on day D+1 (plan start 05:00, 4h blocks).
func TestZonesNextDayFull_S7NotRotatingBefore13AfterFullDay(t *testing.T) {
	root := filepath.Join("..", "zones_next_day_full.yaml")
	roster := filepath.Join("..", "roaster1.yaml")
	zraw, err := os.ReadFile(root)
	if err != nil {
		t.Fatal(err)
	}
	rraw, err := os.ReadFile(roster)
	if err != nil {
		t.Fatal(err)
	}
	zc, err := LoadZoneConfigYAML(zraw, 5, nil)
	if err != nil {
		t.Fatal(err)
	}
	const n = 18 // seed 42: kitchen team rest respected through day-2 13:00 (n=22 allows early day-2 rotations)
	keys := Roster(n)
	typeCodes, err := LoadRosterTypeCodesYAML(rraw, keys)
	if err != nil {
		t.Fatal(err)
	}
	if zc.Slots[4].Pattern != "full_day" && zc.Slots[4].Pattern != "full_day_team" {
		t.Fatalf("slot 4 pattern=%q want full_day or full_day_team", zc.Slots[4].Pattern)
	}
	const kitchenSlot = 4
	planStart := 5
	anchor := time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)
	r := NewPyRandom(42)
	recs, _, err := RunSimulationZoneConfig(
		zc, n, 2, r, 6, true, 0, 2, 2, 0.2, planStart, nil, &anchor, typeCodes, nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	fullDaySoldier := -1
	for _, a := range recs {
		if a.Day == 0 && a.Slot == kitchenSlot && (a.Kind == "full_day" || a.Kind == "full_day_team") {
			fullDaySoldier = a.SoldierIdx
			break
		}
	}
	if fullDaySoldier < 0 {
		t.Fatal("no kitchen post on day 0")
	}
	// full_day 09–09 + 4h rest → no rotate before 13:00; team 05–22 + 6h → before 13:00 on day 1 as well.
	for _, a := range recs {
		if a.Day != 1 || a.Kind != "rotating" || a.SoldierIdx != fullDaySoldier {
			continue
		}
		if a.CalendarBlock < 2 {
			startH := BlockStartHour(planStart, a.CalendarBlock, zc.ShiftHours)
			t.Fatalf("soldier %d rotating day 1 block %d at %02d:00 before 13:00 after 09–09 + 4h rest",
				fullDaySoldier, a.CalendarBlock, startH)
		}
	}
}

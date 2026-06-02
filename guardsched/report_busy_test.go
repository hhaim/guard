package guardsched

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Timeline + soldier table use duty+rest linear span (zones_next_day_full, seed 42).
// Soldier index 1 (UI "S1"): plan day 1 block 2 (09:00–13:00) = L, busy on timeline.
func TestReportBusy_zonesNextDayFull_S1Day1Block2(t *testing.T) {
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
	const n = 22
	keys := Roster(n)
	typeCodes, err := LoadRosterTypeCodesYAML(rraw, keys)
	if err != nil {
		t.Fatal(err)
	}
	B, err := CalendarBlocksPerDaySafe(zc.ShiftHours)
	if err != nil {
		t.Fatal(err)
	}
	planStart := 5
	anchor := time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)
	r := NewPyRandom(42)
	recs, _, err := RunSimulationZoneConfig(
		zc, n, 2, r, 6, true, 0, 2, 2, 0.2, planStart, nil, &anchor, typeCodes, nil, nil,
	)
	if err != nil {
		t.Fatal(err)
	}

	const soldier = 1 // UI Soldier S1
	const day, block = 0, 1

	lookup := LinearBusyBlockLookup(recs, 2, B)
	if !BusySpanCovered(lookup, soldier, day, block) {
		t.Fatalf("soldier %d day %d block %d not in duty+rest span lookup", soldier, day, block)
	}
	a := lookup[[3]int{soldier, day, block}]
	if a.LocI != 2 {
		t.Fatalf("span loc_i=%d want 2 (kitchen team L)", a.LocI)
	}

	busyTL := BuildBusyTensor(recs, 2, n, B, true)
	if !busyTL[day][soldier][block] {
		t.Fatalf("timeline busy[%d][%d][%d] want true (duty+rest red)", day, soldier, block)
	}
	busyDuty := BuildBusyTensor(recs, 2, n, B, false)
	if !busyDuty[day][soldier][block] {
		t.Fatalf("duty-only busy[%d][%d][%d] want true (09:00 plan block is first kitchen duty block)", day, soldier, block)
	}

	fullDay := BuildFullDayDutyTensor(recs, 2, n, B, true)
	if !fullDay[day][soldier][block] {
		t.Fatalf("full_day duty[%d][%d][%d] want true (kitchen team orange span)", day, soldier, block)
	}
	for d := 0; d < 2; d++ {
		for s := 0; s < n; s++ {
			for b := 0; b < B; b++ {
				if fullDay[d][s][b] && !busyTL[d][s][b] {
					t.Fatalf("full_day busy at %d/%d/%d without timeline busy", d, s, b)
				}
			}
		}
	}

	for key, rec := range lookup {
		if !busyTL[key[1]][key[0]][key[2]] {
			t.Fatalf("timeline missing red at soldier=%d day=%d block=%d", key[0], key[1], key[2])
		}
		_ = rec
	}
}

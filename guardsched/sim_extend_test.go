package guardsched

import (
	"os"
	"path/filepath"
	"testing"
)

func TestGapCrossDayAfterPrefixReplay(t *testing.T) {
	B := 6
	prefixDays, extendDays := 1, 1
	totalDays := prefixDays + extendDays
	busyRot := new3DBool(totalDays, 2, B)
	// Soldier 0 on last block of prefix day (01:00–05:00 with 4h grid, plan start 05:00).
	busyRot[0][0][B-1] = true
	gap := gapFreeBlocksSinceLastDutyBeforeAssign(busyRot, prefixDays, 0, 0, B)
	if gap != 0 {
		t.Fatalf("block 0 day after prefix: gap=%d want 0", gap)
	}
	gap1 := gapFreeBlocksSinceLastDutyBeforeAssign(busyRot, prefixDays, 1, 0, B)
	if gap1 != 1 {
		t.Fatalf("block 1 day after prefix: gap=%d want 1", gap1)
	}
}

func loadRotatingOnlyZone(t *testing.T, slots int) *ZoneConfig {
	t.Helper()
	root := findRepoRoot(t)
	zraw, err := os.ReadFile(filepath.Join(root, "testdata", "zones_s1_gate4.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	z, err := LoadZoneConfigYAML(zraw, slots, nil)
	if err != nil {
		t.Fatal(err)
	}
	return z
}

func TestReplayPrefixRotatingUpdatesSoldierWeights(t *testing.T) {
	zone := loadRotatingOnlyZone(t, 4)
	B, _ := CalendarBlocksPerDaySafe(zone.ShiftHours)
	nl, nt := len(zone.Locations), len(zone.TimeBands)
	soldiers := []*Soldier{makeSoldier(0, 24, nl, nt)}
	busy := new3DBool(1, 1, B)
	busyRot := new3DBool(1, 1, B)
	drl := new3DFloat(1, 1, nl)
	drt := new3DFloat(1, 1, nt)
	prefix := []*AssignmentRecord{{
		Day: 0, CalendarBlock: 0, Slot: 0, SoldierIdx: 0,
		LocI: 0, TimeJ: 1, Weight: 4, RawHours: 4, Kind: "rotating",
	}}
	if err := ReplayPrefixAssignments(zone, soldiers, busy, busyRot, drl, drt, prefix, 1, B, 5); err != nil {
		t.Fatal(err)
	}
	if soldiers[0].WGlobal <= 0 {
		t.Fatalf("expected positive WGlobal after replay, got %v", soldiers[0].WGlobal)
	}
	if !busyRot[0][0][0] {
		t.Fatal("busy_rot not set")
	}
}

func TestExtendCooldownFromPrefixLastBlock(t *testing.T) {
	zone := loadRotatingOnlyZone(t, 4)
	B, _ := CalendarBlocksPerDaySafe(zone.ShiftHours)
	lastB := B - 1
	prefix := []*AssignmentRecord{{
		Day: 0, CalendarBlock: lastB, Slot: 0, SoldierIdx: 0,
		LocI: 0, TimeJ: 0, Weight: 4, RawHours: 4, Kind: "rotating",
	}}
	ext, _, err := RunSimulationZoneConfigExtend(
		zone, 12, 1, 1, prefix, NewPyRandom(99),
		6, true, 0, 2, 2, 0.2,
		5, nil, nil, nil, nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range ext {
		if a.SoldierIdx == 0 && a.CalendarBlock < 2 {
			t.Fatalf("S0 should be cooldown-blocked on blocks 0-1 after last-block prefix duty, got block %d", a.CalendarBlock)
		}
	}
}

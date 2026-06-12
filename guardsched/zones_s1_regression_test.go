package guardsched

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func assertNoPerBlockAssignmentOverlap(t *testing.T, recs []*AssignmentRecord) {
	t.Helper()
	type slotKind struct {
		kind string
		slot int
	}
	occ := make(map[[3]int]slotKind)
	for _, a := range recs {
		if a == nil {
			continue
		}
		kind := a.Kind
		if kind == "" {
			kind = "rotating"
		}
		b0, b1 := a.CalendarBlock, a.CalendarBlock
		if kind == "full_day" || kind == "full_day_team" || kind == "windowed" {
			b0, b1 = a.WinStartBlock, a.WinEndBlock
		}
		for b := b0; b <= b1; b++ {
			key := [3]int{a.Day, a.SoldierIdx, b}
			cur := slotKind{kind, a.Slot}
			if prev, ok := occ[key]; ok && (prev.kind != cur.kind || prev.slot != cur.slot) {
				t.Fatalf("overlap day=%d S%d block=%d: %+v vs %+v", a.Day+1, a.SoldierIdx, b, prev, cur)
			}
			occ[key] = cur
		}
	}
}

func TestRunSimulation_zonesS1_17x5_30d_noPerBlockOverlap(t *testing.T) {
	// Regression for:
	//   python3 guard_scheduler_sim.py -x 17 -y 5 -d 30 --seed 42 \
	//     --min-consecutive-free-hours 6 --zones zones_s1.yaml \
	//     --min-free-shifts-after-duty 2 --roster roaster1.yaml --anchor-date 2026-05-27
	root := findRepoRoot(t)
	zraw, err := os.ReadFile(filepath.Join(root, "zones_s1.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	z, err := LoadZoneConfigYAML(zraw, 5, nil)
	if err != nil {
		t.Fatal(err)
	}
	rraw, err := os.ReadFile(filepath.Join(root, "roaster1.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	keys := Roster(17)
	typeCodes, err := LoadRosterTypeCodesYAML(rraw, keys)
	if err != nil {
		t.Fatal(err)
	}
	anchor := time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)
	planStartHour, err := ParsePlanDayStart(DefaultPlanDayStart)
	if err != nil {
		t.Fatal(err)
	}
	seed := int64(42)
	recs, _, _, err := RunSimulationBestOfZoneConfig(
		z, 17, 30, 1, &seed,
		6, true, 0, 2, 2, 0.2, planStartHour, nil, &anchor, typeCodes, nil, nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(recs) != 870 {
		t.Fatalf("assignments=%d want 870", len(recs))
	}
	assertNoPerBlockAssignmentOverlap(t, recs)
}

func TestRunSimulation_zonesS2_17x5_30d_disabledWeekdaysNoPerBlockOverlap(t *testing.T) {
	// Regression for:
	//   python3 guard_scheduler_sim.py -x 17 -y 5 -d 30 --seed 42 \
	//     --min-consecutive-free-hours 6 --zones zones_s2.yaml \
	//     --min-free-shifts-after-duty 2 --roster roaster1.yaml --anchor-date 2026-05-27
	// zones_s2: kitchen_team_1 disabled_weekdays [friday, saturday] (day removal).
	root := findRepoRoot(t)
	zraw, err := os.ReadFile(filepath.Join(root, "zones_s2.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	z, err := LoadZoneConfigYAML(zraw, 5, nil)
	if err != nil {
		t.Fatal(err)
	}
	rraw, err := os.ReadFile(filepath.Join(root, "roaster1.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	keys := Roster(17)
	typeCodes, err := LoadRosterTypeCodesYAML(rraw, keys)
	if err != nil {
		t.Fatal(err)
	}
	anchor := time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)
	planStartHour, err := ParsePlanDayStart(DefaultPlanDayStart)
	if err != nil {
		t.Fatal(err)
	}
	seed := int64(42)
	recs, _, _, err := RunSimulationBestOfZoneConfig(
		z, 17, 30, 1, &seed,
		6, true, 0, 2, 2, 0.2, planStartHour, nil, &anchor, typeCodes, nil, nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(recs) != 830 {
		t.Fatalf("assignments=%d want 830", len(recs))
	}
	assertNoPerBlockAssignmentOverlap(t, recs)
	const teamTypeID = "kitchen_team_1"
	for _, a := range recs {
		if a == nil || a.Kind != "full_day_team" {
			continue
		}
		wd := WeekdayAtPlanDayStart(anchor, a.Day, planStartHour)
		if z.IsSlotTypeDisabledOnWeekday(teamTypeID, wd) {
			t.Fatalf("full_day_team on disabled weekday plan day %d (weekday=%d)", a.Day+1, wd)
		}
	}
}

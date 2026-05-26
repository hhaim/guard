package guardsched

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"guard/internal/availability"
)

func loadZonesS1(t *testing.T, slots int) *ZoneConfig {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "zones_s1.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	zc, err := LoadZoneConfigYAML(raw, slots, nil)
	if err != nil {
		t.Fatal(err)
	}
	return zc
}

func prepareScenario(t *testing.T, path string, nSoldiers int, anchor time.Time) (*Scenario, *availability.Checker, []string) {
	t.Helper()
	sc, err := LoadScenarioFile(path)
	if err != nil {
		t.Fatal(err)
	}
	sc.Sim.PlanDayStart = DefaultPlanDayStart
	if sc.Sim.Days < 1 {
		sc.Sim.Days = 1
	}
	if err := sc.ResolveTimes(anchor); err != nil {
		t.Fatal(err)
	}
	roster := Roster(nSoldiers)
	chk, err := sc.BuildChecker(roster)
	if err != nil {
		t.Fatal(err)
	}
	return sc, chk, roster
}

func assertRotatingRespectsAvail(t *testing.T, chk *availability.Checker, recs []*AssignmentRecord, planStart int, sh float64) {
	t.Helper()
	for _, a := range recs {
		if a == nil || a.Kind != "rotating" {
			continue
		}
		if !chk.AvailRotatingBlock(a.SoldierIdx, a.Day, a.CalendarBlock, planStart, sh) {
			t.Fatalf("s%d assigned rotating day=%d block=%d but checker rejects block",
				a.SoldierIdx, a.Day, a.CalendarBlock)
		}
	}
}

func TestPartialReturn_rotatingBlocksPool(t *testing.T) {
	anchor := time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)
	_, chk, _ := prepareScenario(t, filepath.Join("..", "testdata", "scenarios", "partial_return.yaml"), 12, anchor)
	planStart := 5
	sh := 4.0

	type blockExp struct {
		block    int
		s2Avail  bool
		minPool  int
	}
	expect := []blockExp{
		{0, false, 11},
		{1, false, 11},
		{2, true, 12},
		{3, true, 12},
		{4, true, 12},
		{5, true, 12},
	}
	for _, e := range expect {
		if chk.AvailRotatingBlock(2, 0, e.block, planStart, sh) != e.s2Avail {
			t.Fatalf("block %d s2 avail got %v want %v", e.block, !e.s2Avail, e.s2Avail)
		}
		pool := 0
		for i := 0; i < 12; i++ {
			if chk.AvailRotatingBlock(i, 0, e.block, planStart, sh) {
				pool++
			}
		}
		if pool < e.minPool {
			t.Fatalf("block %d pool=%d want >=%d", e.block, pool, e.minPool)
		}
	}
}

func TestRunSimulation_statusYAML(t *testing.T) {
	anchor := time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)
	zc := loadZonesS1(t, 4)
	planStart, _ := ParsePlanDayStart(DefaultPlanDayStart)
	sh := zc.ShiftHours
	seed := int64(42)

	for _, n := range []int{12, 14, 16} {
		t.Run(fmt.Sprintf("n%d", n), func(t *testing.T) {
			_, chk, _ := prepareScenario(t, filepath.Join("..", "status.yaml"), n, anchor)
			recs, _, _, err := RunSimulationBestOfZoneConfig(
				zc, n, 1, 1, &seed,
				6, true, 0, 2, 0, 0.2, planStart, chk,
			)
			if err != nil {
				t.Fatalf("n=%d: %v", n, err)
			}
			blocksPD, _ := CalendarBlocksPerDaySafe(sh)
			nRot := 0
			for _, a := range recs {
				if a != nil && a.Kind == "rotating" {
					nRot++
				}
			}
			if nRot != blocksPD*4 {
				t.Fatalf("n=%d rotating assignments=%d want %d", n, nRot, blocksPD*4)
			}
			assertRotatingRespectsAvail(t, chk, recs, planStart, sh)
		})
	}
}

func TestRunSimulation_partialReturn_noS2Morning(t *testing.T) {
	anchor := time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)
	zc := loadZonesS1(t, 4)
	planStart, _ := ParsePlanDayStart(DefaultPlanDayStart)
	sc, chk, roster := prepareScenario(t, filepath.Join("..", "testdata", "scenarios", "partial_return.yaml"), 12, anchor)
	seed := sc.Sim.Seed
	recs, _, _, err := RunSimulationBestOfZoneConfig(
		zc, len(roster), sc.Sim.Days, 1, &seed,
		6, true, 0, 2, 0, 0.2, planStart, chk,
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := sc.CheckExpectations(chk, recs, roster); err != nil {
		t.Fatal(err)
	}
	assertRotatingRespectsAvail(t, chk, recs, planStart, zc.ShiftHours)
	for _, a := range recs {
		if a == nil || a.Kind != "rotating" {
			continue
		}
		if a.SoldierIdx == 2 && a.CalendarBlock < 2 {
			t.Fatalf("s2 on morning block %d", a.CalendarBlock)
		}
	}
}

func TestRunSimulation_sickAndOuting(t *testing.T) {
	anchor := time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)
	zc := loadZonesS1(t, 4)
	planStart, _ := ParsePlanDayStart(DefaultPlanDayStart)
	sh := zc.ShiftHours

	t.Run("sick_full_day", func(t *testing.T) {
		sc, chk, roster := prepareScenario(t, filepath.Join("..", "testdata", "scenarios", "sick_full_day.yaml"), 12, anchor)
		seed := sc.Sim.Seed
		recs, _, _, err := RunSimulationBestOfZoneConfig(
			zc, len(roster), 1, 1, &seed,
			6, true, 0, 2, 0, 0.2, planStart, chk,
		)
		if err != nil {
			t.Fatal(err)
		}
		for _, a := range recs {
			if a != nil && a.Kind == "rotating" && a.SoldierIdx == 3 {
				t.Fatalf("s3 sick but assigned block %d", a.CalendarBlock)
			}
		}
		assertRotatingRespectsAvail(t, chk, recs, planStart, sh)
	})

	t.Run("evening_outing", func(t *testing.T) {
		sc, chk, roster := prepareScenario(t, filepath.Join("..", "testdata", "scenarios", "evening_outing.yaml"), 12, anchor)
		if chk.AvailRotatingBlock(5, 0, 4, planStart, sh) {
			t.Fatal("s5 should not be available for block 4 during outing")
		}
		seed := sc.Sim.Seed
		recs, _, _, err := RunSimulationBestOfZoneConfig(
			zc, len(roster), 1, 1, &seed,
			6, true, 0, 2, 0, 0.2, planStart, chk,
		)
		if err != nil {
			t.Fatal(err)
		}
		for _, a := range recs {
			if a != nil && a.Kind == "rotating" && a.SoldierIdx == 5 && (a.CalendarBlock == 3 || a.CalendarBlock == 4) {
				t.Fatalf("s5 on outing block %d", a.CalendarBlock)
			}
		}
		assertRotatingRespectsAvail(t, chk, recs, planStart, sh)
	})
}

func TestStatusV2_matchesPartialReturn(t *testing.T) {
	anchor := time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)
	scFix, err := LoadScenarioFile(filepath.Join("..", "testdata", "scenarios", "partial_return.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	scV2, err := LoadScenarioFile(filepath.Join("..", "status.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if !scV2.IsStatusOnly() {
		t.Fatal("status.yaml should be status-only v2")
	}
	if err := scFix.ResolveTimes(anchor); err != nil {
		t.Fatal(err)
	}
	scV2.Sim.PlanDayStart = DefaultPlanDayStart
	scV2.Sim.Days = 1
	if err := scV2.ResolveTimes(anchor); err != nil {
		t.Fatal(err)
	}
	roster := Roster(12)
	chkFix, _ := scFix.BuildChecker(roster)
	chkV2, _ := scV2.BuildChecker(roster)
	d1 := chkFix.CompileDay(0)
	d2 := chkV2.CompileDay(0)
	if d1.Summary.Full != d2.Summary.Full || d1.Summary.AbsentPartial != d2.Summary.AbsentPartial {
		t.Fatalf("summary mismatch fix=%+v v2=%+v", d1.Summary, d2.Summary)
	}
}

func TestMultiSoldier_compileAndSim(t *testing.T) {
	anchor := time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)
	roster := Roster(14)
	entries := []availability.Entry{
		{
			SoldierID: "s2",
			StartAt: anchor.AddDate(0, 0, -1).Add(5 * time.Hour),
			EndAt:   ptrTime(anchor.Add(12 * time.Hour)),
			Status:  availability.StatusAway,
		},
		{
			SoldierID: "s5",
			StartAt: anchor.Add(20 * time.Hour),
			EndAt:   ptrTime(anchor.AddDate(0, 0, 1).Add(1 * time.Hour)),
			Status:  availability.StatusOuting,
		},
		{
			SoldierID: "s3",
			StartAt: anchor.Add(5 * time.Hour),
			EndAt:   ptrTime(anchor.AddDate(0, 0, 1).Add(5 * time.Hour)),
			Status:  availability.StatusSick,
		},
	}
	chk := availability.NewChecker(anchor, 5, roster, entries, 1)
	day := chk.CompileDay(0)
	if day.Summary.Full != 11 || day.Summary.AbsentFull != 1 || day.Summary.AbsentPartial != 2 {
		t.Fatalf("compile: %+v", day.Summary)
	}

	zc := loadZonesS1(t, 4)
	planStart := 5
	seed := int64(123)
	recs, _, _, err := RunSimulationBestOfZoneConfig(
		zc, 14, 1, 1, &seed,
		6, true, 0, 2, 0, 0.2, planStart, chk,
	)
	if err != nil {
		t.Fatal(err)
	}
	assertRotatingRespectsAvail(t, chk, recs, planStart, zc.ShiftHours)
	for _, a := range recs {
		if a == nil || a.Kind != "rotating" {
			continue
		}
		if a.SoldierIdx == 3 {
			t.Fatal("s3 sick assigned")
		}
		if a.SoldierIdx == 2 && a.CalendarBlock < 2 {
			t.Fatalf("s2 morning block %d", a.CalendarBlock)
		}
		if a.SoldierIdx == 5 && (a.CalendarBlock == 3 || a.CalendarBlock == 4) {
			t.Fatalf("s5 outing block %d", a.CalendarBlock)
		}
	}
}

func ptrTime(t time.Time) *time.Time { return &t }

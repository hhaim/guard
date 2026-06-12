package guardsched

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestStatusOnlyV2YAML(t *testing.T) {
	sc, err := LoadScenarioFile("../status.yaml")
	if err != nil {
		t.Fatal(err)
	}
	if !sc.IsStatusOnly() {
		t.Fatal("expected status-only v2 scenario")
	}
	if len(sc.Status) != 1 || sc.Status[0].Soldier != "s2" {
		t.Fatalf("status: %+v", sc.Status)
	}
	anchor := time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)
	sc.Sim.PlanDayStart = DefaultPlanDayStart
	sc.Sim.Days = 1
	if err := sc.ResolveTimes(anchor); err != nil {
		t.Fatal(err)
	}
	roster := Roster(12)
	chk, err := sc.BuildChecker(roster)
	if err != nil {
		t.Fatal(err)
	}
	day := chk.CompileDay(0)
	if day.Summary.Full != 11 || day.Summary.AbsentPartial != 1 {
		t.Fatalf("summary: %+v", day.Summary)
	}
}

func TestScenarioYAML(t *testing.T) {
	paths, err := filepath.Glob("../testdata/scenarios/*.yaml")
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) == 0 {
		t.Skip("no scenario files")
	}
	anchor := time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)
	for _, path := range paths {
		t.Run(filepath.Base(path), func(t *testing.T) {
			sc, err := LoadScenarioFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if err := sc.ResolveTimes(anchor); err != nil {
				t.Fatal(err)
			}
			roster := make([]string, 12)
			for i := range roster {
				roster[i] = fmt.Sprintf("s%d", i)
			}
			chk, err := sc.BuildChecker(roster)
			if err != nil {
				t.Fatal(err)
			}
			for _, exp := range sc.Expect.Availability {
				day := chk.CompileDay(exp.PlanDay)
				if day.Summary.Full != exp.Summary.Full ||
					day.Summary.AbsentFull != exp.Summary.AbsentFull ||
					day.Summary.AbsentPartial != exp.Summary.AbsentPartial {
					t.Fatalf("plan_day %d summary: got %+v want full=%d absent_full=%d absent_partial=%d",
						exp.PlanDay, day.Summary, exp.Summary.Full, exp.Summary.AbsentFull, exp.Summary.AbsentPartial)
				}
			}
			if len(sc.Expect.Assignments.Forbid) == 0 {
				return
			}
			zonesPath, err := ResolveZonesPath(path, sc.Zones.File)
			if err != nil {
				t.Fatal(err)
			}
			raw, err := os.ReadFile(zonesPath)
			if err != nil {
				t.Fatal(err)
			}
			slots := sc.Zones.SlotsPerBlock
			if slots < 1 {
				slots = 4
			}
			zc, err := LoadZoneConfigYAML(raw, slots, nil)
			if err != nil {
				t.Fatal(err)
			}
			planStart, _ := ParsePlanDayStart(sc.Sim.PlanDayStart)
			seed := sc.Sim.Seed
			recs, _, _, err := RunSimulationBestOfZoneConfig(
				zc, len(roster), sc.Sim.Days, 1, &seed,
				6, true, 0, 2, 0, 0.2, planStart, chk, &sc.AnchorDate, nil, nil, nil,
			)
			if err != nil {
				t.Fatal(err)
			}
			if err := sc.CheckExpectations(chk, recs, roster); err != nil {
				t.Fatal(err)
			}
		})
	}
}

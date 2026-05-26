package guardsched

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRunSimulationZoneConfig_allRotatingZonesS1(t *testing.T) {
	root := findRepoRoot(t)
	raw, err := os.ReadFile(filepath.Join(root, "zones_s1.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	z, err := LoadZoneConfigYAML(raw, 4, nil)
	if err != nil {
		t.Fatal(err)
	}
	r := NewPyRandom(42)
	_, _, err = RunSimulationZoneConfig(z, 10, 5, r, 8, true, 0, 2, 0, 0.2, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
}

func TestRunSimulationZoneConfig_twelveSoldiersFourRotatingSlots(t *testing.T) {
	root := findRepoRoot(t)
	raw, err := os.ReadFile(filepath.Join(root, "zones_s1.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	z, err := LoadZoneConfigYAML(raw, 4, nil)
	if err != nil {
		t.Fatal(err)
	}
	r := NewPyRandom(1)
	_, _, err = RunSimulationZoneConfig(z, 12, 1, r, 6, true, 0, 2, 2, 0.2, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
}

func TestRunSimulationZoneConfig_mixedPatternsFile(t *testing.T) {
	root := findRepoRoot(t)
	raw, err := os.ReadFile(filepath.Join(root, "zones_mixed_patterns.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	nSlots := 15
	z, err := LoadZoneConfigYAML(raw, nSlots, nil)
	if err != nil {
		t.Fatal(err)
	}
	r := NewPyRandom(7)
	_, _, err = RunSimulationZoneConfig(z, 50, 2, r, 8, true, 0, 2, 0, 0.2, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
}

func TestRunSimulationZoneConfig_planDayStartRotatingHour(t *testing.T) {
	root := findRepoRoot(t)
	raw, err := os.ReadFile(filepath.Join(root, "zones_s1.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	z, err := LoadZoneConfigYAML(raw, 4, nil)
	if err != nil {
		t.Fatal(err)
	}
	r := NewPyRandom(7)
	recs, _, err := RunSimulationZoneConfig(z, 12, 1, r, 6, true, 0, 2, 2, 0.2, 5, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range recs {
		if a == nil || a.Kind != "rotating" {
			continue
		}
		if a.CalendarBlock == 0 && a.StartHour != 5 {
			t.Fatalf("first rotating block start_hour=%d want 5", a.StartHour)
		}
		return
	}
	t.Fatal("no rotating assignment found")
}

func findRepoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("go.mod not found")
		}
		dir = parent
	}
}

package guardsched

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func loadFullDayTeamFixture(t *testing.T) (*ZoneConfig, []string, int) {
	t.Helper()
	root := filepath.Join("..", "testdata", "full_day_team")
	zraw, err := os.ReadFile(filepath.Join(root, "zones.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	rraw, err := os.ReadFile(filepath.Join(root, "roster.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	zc, err := LoadZoneConfigYAML(zraw, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	keys := Roster(12)
	typeCodes, err := LoadRosterTypeCodesYAML(rraw, keys)
	if err != nil {
		t.Fatal(err)
	}
	return zc, typeCodes, 12
}

func TestLoadZoneConfig_fullDayTeam(t *testing.T) {
	zc, _, _ := loadFullDayTeamFixture(t)
	cfg := zc.FullDayTeamSpecs["team_post"]
	if cfg.Headcount != 6 {
		t.Fatalf("headcount=%d want 6", cfg.Headcount)
	}
	if cfg.TypeQuotas["A"] != 1 || cfg.TypeQuotas["B"] != 2 || cfg.TypeQuotas["C"] != 1 {
		t.Fatalf("quotas=%v", cfg.TypeQuotas)
	}
	if cfg.HoursFactor != 1 {
		t.Fatalf("hours_factor=%v want default 1", cfg.HoursFactor)
	}
}

func TestLoadZoneConfig_fullDayTeam_hoursFactor(t *testing.T) {
	raw := []byte(`schema_version: 2
shift_hours: 4
slots_types:
  - id: team
    pattern: full_day_team
    config:
      start: "09:00"
      end: "09:00"
      hours_factor: 0.33
      headcount: 2
      type_quotas: { A: 1 }
zone_loc:
  - { id: loc, type: team, name: T, weight: 1.0 }
slots:
  - { location_id: loc, name: t1 }
time_zones:
  - { id: all, name: All, weight: 1.0, from_hour: 0, to_hour: "24:00" }
`)
	zc, err := LoadZoneConfigYAML(raw, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	cfg := zc.FullDayTeamSpecs["team"]
	if cfg.HoursFactor != 0.33 {
		t.Fatalf("hours_factor=%v want 0.33", cfg.HoursFactor)
	}
}

func TestRunSimulation_fullDayTeam_hoursFactor(t *testing.T) {
	raw := []byte(`schema_version: 2
shift_hours: 4
slots_types:
  - id: team
    pattern: full_day_team
    config:
      start: "09:00"
      end: "09:00"
      hours_factor: 0.33
      weight_multiplier: 1.1
      headcount: 1
zone_loc:
  - { id: loc, type: team, name: T, weight: 1.0 }
slots:
  - { location_id: loc, name: t1 }
time_zones:
  - { id: all, name: All, weight: 1.0, from_hour: 0, to_hour: "24:00" }
`)
	zc, err := LoadZoneConfigYAML(raw, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	typeCodes := []string{"A"}
	anchor := time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)
	r := NewPyRandom(42)
	recs, _, err := RunSimulationZoneConfig(
		zc, 4, 1, r, 6, true, 0, 0, 0, 0.2, 0, nil, &anchor, typeCodes, nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(recs) != 1 {
		t.Fatalf("assignments=%d want 1", len(recs))
	}
	a := recs[0]
	wantRaw := 24.0 * 0.33
	if a.RawHours != wantRaw {
		t.Fatalf("raw_hours=%v want %v", a.RawHours, wantRaw)
	}
	if a.Weight <= 0 {
		t.Fatalf("weight=%v want > 0", a.Weight)
	}
}

func TestRunSimulation_fullDayTeam_counts(t *testing.T) {
	zc, typeCodes, n := loadFullDayTeamFixture(t)
	anchor := time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)
	r := NewPyRandom(42)
	recs, _, err := RunSimulationZoneConfig(
		zc, n, 2, r, 6, true, 0, 2, 0, 0.2, 0, nil, &anchor, typeCodes, nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(recs) != 12 {
		t.Fatalf("assignments=%d want 12", len(recs))
	}
	for _, a := range recs {
		if a.Kind != "full_day_team" || a.Slot != 0 {
			t.Fatalf("unexpected record: %+v", a)
		}
	}
}

func TestRunSimulation_fullDayTeam_quotas(t *testing.T) {
	zc, typeCodes, n := loadFullDayTeamFixture(t)
	anchor := time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)
	r := NewPyRandom(42)
	recs, _, err := RunSimulationZoneConfig(
		zc, n, 2, r, 6, true, 0, 2, 0, 0.2, 0, nil, &anchor, typeCodes, nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	for day := 0; day < 2; day++ {
		counts := map[string]int{}
		for _, a := range recs {
			if a.Day != day {
				continue
			}
			if a.SoldierIdx >= 0 && a.SoldierIdx < len(typeCodes) {
				counts[typeCodes[a.SoldierIdx]]++
			}
		}
		if counts["A"] < 1 || counts["B"] < 2 || counts["C"] < 1 {
			t.Fatalf("day %d type counts %v", day, counts)
		}
	}
}

func TestRunSimulation_fullDayTeam_busy(t *testing.T) {
	zc, typeCodes, n := loadFullDayTeamFixture(t)
	anchor := time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)
	r := NewPyRandom(42)
	recs, _, err := RunSimulationZoneConfig(
		zc, n, 1, r, 6, true, 0, 2, 0, 0.2, 0, nil, &anchor, typeCodes, nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(recs) != 6 {
		t.Fatal(len(recs))
	}
	a := recs[0]
	if a.LinearBusySpanBlocks <= 0 {
		t.Fatalf("expected linear busy span, got %d", a.LinearBusySpanBlocks)
	}
}

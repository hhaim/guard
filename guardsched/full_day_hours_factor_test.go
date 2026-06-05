package guardsched

import (
	"testing"
	"time"
)

func TestLoadZoneConfig_fullDay_hoursFactor(t *testing.T) {
	raw := []byte(`schema_version: 2
shift_hours: 4
slots_types:
  - id: kitchen
    pattern: full_day
    config:
      start: "06:00"
      end: "22:00"
      hours_factor: 0.5
      headcount: 1
zone_loc:
  - { id: loc, type: kitchen, name: K, weight: 1.0 }
slots:
  - { location_id: loc, name: k1 }
time_zones:
  - { id: all, name: All, weight: 1.0, from_hour: 0, to_hour: "24:00" }
`)
	zc, err := LoadZoneConfigYAML(raw, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	cfg := zc.FullDaySpecs["kitchen"]
	if cfg.HoursFactor != 0.5 {
		t.Fatalf("hours_factor=%v want 0.5", cfg.HoursFactor)
	}
}

func TestRunSimulation_fullDay_hoursFactor(t *testing.T) {
	raw := []byte(`schema_version: 2
shift_hours: 4
slots_types:
  - id: kitchen
    pattern: full_day
    config:
      start: "06:00"
      end: "22:00"
      hours_factor: 0.5
      weight_multiplier: 1.0
      headcount: 1
zone_loc:
  - { id: loc, type: kitchen, name: K, weight: 1.0 }
slots:
  - { location_id: loc, name: k1 }
time_zones:
  - { id: all, name: All, weight: 1.0, from_hour: 0, to_hour: "24:00" }
`)
	zc, err := LoadZoneConfigYAML(raw, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	typeCodes := []string{"E"}
	anchor := time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)
	r := NewPyRandom(42)
	recs, _, err := RunSimulationZoneConfig(
		zc, 4, 1, r, 6, true, 0, 0, 0, 0.2, 0, nil, &anchor, typeCodes, nil, nil, nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(recs) != 1 {
		t.Fatalf("assignments=%d want 1", len(recs))
	}
	a := recs[0]
	if a.Kind != "full_day" {
		t.Fatalf("kind=%q want full_day", a.Kind)
	}
	wantRaw := 17.0 * 0.5
	if a.RawHours != wantRaw {
		t.Fatalf("raw_hours=%v want %v", a.RawHours, wantRaw)
	}
	if a.Weight <= 0 {
		t.Fatalf("weight=%v want > 0", a.Weight)
	}
}

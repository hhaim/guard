package guardsched

import (
	"testing"
	"time"
)

func TestLoadZoneConfig_pinPlatoonFlag(t *testing.T) {
	raw := []byte(`schema_version: 2
shift_hours: 4
slots_types:
  - id: team
    pattern: full_day_team
    config:
      start: "09:00"
      end: "17:00"
      headcount: 2
      pin_platoon: true
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
	if !zc.FullDayTeamSpecs["team"].PinPlatoon {
		t.Fatal("expected pin_platoon from config.pin_platoon")
	}

	raw2 := []byte(`schema_version: 2
shift_hours: 4
slots_types:
  - id: team
    pattern: full_day_team
    config:
      start: "09:00"
      end: "17:00"
      headcount: 2
      features: [pin_platoon]
zone_loc:
  - { id: loc, type: team, name: T, weight: 1.0 }
slots:
  - { location_id: loc, name: t1 }
time_zones:
  - { id: all, name: All, weight: 1.0, from_hour: 0, to_hour: "24:00" }
`)
	zc2, err := LoadZoneConfigYAML(raw2, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !zc2.FullDayTeamSpecs["team"].PinPlatoon {
		t.Fatal("expected pin_platoon from config.features")
	}
}

func TestRunSimulation_fullDayTeam_pinPlatoonSamePlatoon(t *testing.T) {
	raw := []byte(`schema_version: 2
shift_hours: 4
slots_types:
  - id: team
    pattern: full_day_team
    config:
      start: "09:00"
      end: "17:00"
      headcount: 2
      pin_platoon: true
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
	typeCodes := []string{"A", "A", "A", "A"}
	platoonCodes := []string{"1", "1", "2", "2"}
	anchor := time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)
	recs, _, err := RunSimulationZoneConfig(
		zc, 4, 1, NewPyRandom(7), 6, true, 0, 0, 0, 0.2, 0, nil, &anchor, typeCodes, platoonCodes, nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(recs) != 2 {
		t.Fatalf("assignments=%d want 2", len(recs))
	}
	p0 := platoonCodes[recs[0].SoldierIdx]
	p1 := platoonCodes[recs[1].SoldierIdx]
	if p0 == "" || p1 == "" || p0 != p1 {
		t.Fatalf("expected same platoon, got %q and %q (idx %d,%d)", p0, p1, recs[0].SoldierIdx, recs[1].SoldierIdx)
	}
}

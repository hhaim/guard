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

func TestRunSimulation_pinPlatoonPartialFallback(t *testing.T) {
	// Platoon 1 has A+one B; platoon 2 has two B. Strict single-platoon fill fails; prefer fills mixed team.
	raw := []byte(`schema_version: 2
shift_hours: 4
slots_types:
  - id: team
    pattern: full_day_team
    config:
      start: "09:00"
      end: "17:00"
      headcount: 3
      type_quotas: { A: 1, B: 2 }
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
	typeCodes := []string{"A", "B", "B", "B"}
	platoonCodes := []string{"1", "1", "2", "2"}
	anchor := time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)
	recs, _, err := RunSimulationZoneConfig(
		zc, 4, 1, NewPyRandom(11), 6, true, 0, 0, 0, 0.2, 0, nil, &anchor, typeCodes, platoonCodes, nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(recs) != 3 {
		t.Fatalf("assignments=%d want 3", len(recs))
	}
	typeCount := map[string]int{}
	platoonSet := map[string]struct{}{}
	for _, a := range recs {
		typeCount[typeCodes[a.SoldierIdx]]++
		platoonSet[platoonCodes[a.SoldierIdx]] = struct{}{}
	}
	if typeCount["A"] != 1 || typeCount["B"] != 2 {
		t.Fatalf("type quotas not met: %v", typeCount)
	}
	if len(platoonSet) < 2 {
		t.Fatalf("expected mixed platoons after partial fallback, got %v", platoonSet)
	}
}

func TestRunSimulation_pinPlatoonGlobalInfeasible(t *testing.T) {
	raw := []byte(`schema_version: 2
shift_hours: 4
slots_types:
  - id: team
    pattern: full_day_team
    config:
      start: "09:00"
      end: "17:00"
      headcount: 2
      type_quotas: { A: 2 }
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
	typeCodes := []string{"A", "B"}
	platoonCodes := []string{"1", "2"}
	anchor := time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)
	_, _, err = RunSimulationZoneConfig(
		zc, 2, 1, NewPyRandom(3), 6, true, 0, 0, 0, 0.2, 0, nil, &anchor, typeCodes, platoonCodes, nil,
	)
	if err == nil {
		t.Fatal("expected error when type_quotas cannot be met globally")
	}
}

func TestRunSimulation_pinPlatoonPreferBeforeNextPlatoonStrict(t *testing.T) {
	// Top-scored platoon 1 cannot strict-fill (one soldier busy); platoon 2 could strict-fill.
	// Per-platoon loop must relax platoon 1 (prefer) before trying platoon 2 strict.
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
	typeCodes := []string{"A", "A", "A"}
	platoonCodes := []string{"1", "1", "2"}
	busy := new3DBool(1, 3, 24)
	// Block soldier 1 (platoon 1): strict fill from platoon 1 fails; platoon 1 ranks before platoon 2 (both !ok, code tiebreak).
	L0, span := linearBusySpanDutyHoursPlusRest(0, 24, 4, 9, 17, false, 0, 0)
	busySpanSet(busy, 1, L0, span, 24, 1)

	soldiers := make([]*Soldier, 3)
	for i := 0; i < 3; i++ {
		soldiers[i] = makeSoldier(i, 24, 1, 1)
	}
	cfg := zc.FullDayTeamSpecs["team"]
	simZ := zc.ToZone()
	var recs []*AssignmentRecord
	_, err = fillFullDayTeamPostPinPlatoon(
		zc, 0, 0, 0, 0, cfg, soldiers, typeCodes, platoonCodes,
		busy, new3DFloat(1, 3, 1), new3DFloat(1, 3, 1),
		new2DFloat(3, 1), new2DFloat(3, 1), make([]float64, 3),
		simZ, 24, 4, 1, 0, NewPyRandom(5), 0.2, false, 0, nil, &recs, nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(recs) != 2 {
		t.Fatalf("assignments=%d want 2", len(recs))
	}
	hasP1 := false
	for _, a := range recs {
		if platoonCodes[a.SoldierIdx] == "1" {
			hasP1 = true
		}
	}
	if !hasP1 {
		t.Fatalf("expected at least one soldier from preferred platoon 1 after partial fill, got platoons %q %q",
			platoonCodes[recs[0].SoldierIdx], platoonCodes[recs[1].SoldierIdx])
	}
}

func TestFullDayTeamPickPool_preferMode(t *testing.T) {
	soldiers := []*Soldier{
		makeSoldier(0, 24, 1, 1),
		makeSoldier(1, 24, 1, 1),
		makeSoldier(2, 24, 1, 1),
	}
	typeCodes := []string{"A", "B", "B"}
	platoonCodes := []string{"1", "1", "2"}
	excl := map[string]struct{}{}
	busy := new3DBool(1, 3, 6)
	pool := fullDayTeamPickPool(
		soldiers, nil, platoonCodes, "1", platoonPickPrefer, "B",
		typeCodes, excl, busy, 0, 6, 6, 1, 0, 9, 17, nil,
	)
	if len(pool) != 1 || soldierPlatoonCode(platoonCodes, pool[0].Idx) != "1" {
		t.Fatalf("prefer should take B from platoon 1 first, got %v", pool)
	}
}

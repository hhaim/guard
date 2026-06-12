package guardsched

import "testing"

func TestLoadZoneConfigYAML_exclude(t *testing.T) {
	raw := []byte(`
schema_version: 2
shift_hours: 4
slots_types:
  - id: rotating_slot
    name: Rotating
    pattern: rotating
    exclude: [A, B]
slots:
  - location_id: loc_gate
zone_loc:
  - id: loc_gate
    type: rotating_slot
    name: G
    weight: 1.0
time_zones:
  - id: z0
    name: All
    weight: 1
    from_hour: 0
    to_hour: "24:00"
`)
	zc, err := LoadZoneConfigYAML(raw, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	excl := zc.TypeExcludes["rotating_slot"]
	if len(excl) != 2 {
		t.Fatalf("exclude len %d, want 2", len(excl))
	}
	if _, ok := excl["A"]; !ok {
		t.Fatal("missing A")
	}
	if _, ok := excl["B"]; !ok {
		t.Fatal("missing B")
	}
}

func TestSoldierExcludedByType(t *testing.T) {
	excl := map[string]struct{}{"A": {}, "B": {}}
	typeCodes := []string{"A", "C", "B"}
	if !soldierExcludedByType(typeCodes, 0, excl) {
		t.Fatal("idx 0 should be excluded")
	}
	if soldierExcludedByType(typeCodes, 1, excl) {
		t.Fatal("idx 1 should not be excluded")
	}
	if len(typeCodes) == 0 && soldierExcludedByType(nil, 0, excl) {
		t.Fatal("no type codes => no exclusion")
	}
}

func TestRotatingDfsTypeExclude_mixedTypesUnionExclude(t *testing.T) {
	raw := []byte(`
schema_version: 2
shift_hours: 4
slots_types:
  - id: rot_a
    pattern: rotating
    exclude: [A]
  - id: rot_b
    pattern: rotating
slots:
  - location_id: loc_a
  - location_id: loc_b
zone_loc:
  - id: loc_a
    type: rot_a
    name: A
    weight: 1
  - id: loc_b
    type: rot_b
    name: B
    weight: 1
time_zones:
  - id: z0
    name: All
    weight: 1
    from_hour: 0
    to_hour: "24:00"
`)
	zc, err := LoadZoneConfigYAML(raw, 2, nil)
	if err != nil {
		t.Fatal(err)
	}
	rotIdx := []int{0, 1}
	excl, ok := zc.rotatingDfsTypeExclude(rotIdx)
	if !ok {
		t.Fatal("mixed rotating types should use union exclude for DFS")
	}
	if _, has := excl["A"]; !has {
		t.Fatal("union exclude should include A from rot_a")
	}
}

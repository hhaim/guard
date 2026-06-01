package guardsched

import "testing"

func TestZonesYAMLForSimulation_filtersDisabled(t *testing.T) {
	raw := []byte(`
schema_version: 2
shift_hours: 3
slots_types:
  - id: rotating_slot
    name: Rotating
    pattern: rotating
slots:
  - location_id: loc_gate
    name: g1
  - location_id: loc_gate
    name: g2
    disabled: true
  - location_id: loc_gate
    name: g3
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
	filtered, n, err := ZonesYAMLForSimulation(raw)
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("enabled count %d, want 2", n)
	}
	zc, err := LoadZoneConfigYAML(filtered, n, nil)
	if err != nil {
		t.Fatal(err)
	}
	if zc.SlotsPerBlock() != 2 {
		t.Fatalf("SlotsPerBlock %d, want 2", zc.SlotsPerBlock())
	}
	if CountEnabledYAMLSlots(raw) != 2 {
		t.Fatalf("CountEnabledYAMLSlots want 2")
	}
}

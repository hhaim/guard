package guardsched

import "testing"

func TestLoadZoneConfigYAML_slotNameNull(t *testing.T) {
	raw := []byte(`
schema_version: 2
shift_hours: 4
slots_types:
  - id: rotating_slot
    name: Rotating
    pattern: rotating
slots:
  - location_id: loc_gate
    name: null
  - location_id: loc_gate
    full_name: g2
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
	zc, err := LoadZoneConfigYAML(raw, 2, nil)
	if err != nil {
		t.Fatal(err)
	}
	if zc.Slots[0].DisplayName == "<nil>" {
		t.Fatalf("slot 0 display name must not be <nil>, got %q", zc.Slots[0].DisplayName)
	}
	if zc.Slots[1].DisplayName != "g2" {
		t.Fatalf("slot 1 display name %q, want g2", zc.Slots[1].DisplayName)
	}
}

func TestLoadZoneConfigYAML_rejectsNonWholeHourTimes(t *testing.T) {
	raw := []byte(`
schema_version: 2
shift_hours: 4
slots_types:
  - id: kitchen
    name: Kitchen
    pattern: full_day
    config:
      start: "06:30"
      end: "22:00"
slots:
  - location_id: loc_k
    name: k1
zone_loc:
  - id: loc_k
    type: kitchen
    name: K
    weight: 1.0
time_zones:
  - id: z0
    name: All
    weight: 1
    from_hour: 0
    to_hour: "24:00"
`)
	_, err := LoadZoneConfigYAML(raw, 1, nil)
	if err == nil {
		t.Fatal("expected error for non-whole-hour start 06:30")
	}
}

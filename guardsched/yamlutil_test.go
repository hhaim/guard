package guardsched

import "testing"

func TestSoldierKeys(t *testing.T) {
	got := SoldierKeys(3)
	want := []string{"s0", "s1", "s2"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v want %v", got, want)
		}
	}
}

func TestCountYAMLSlots_zonesS1(t *testing.T) {
	raw := []byte(`
slots:
  - location_id: a
  - location_id: a
  - location_id: a
  - location_id: a
`)
	if n := CountYAMLSlots(raw); n != 4 {
		t.Fatalf("count=%d want 4", n)
	}
}

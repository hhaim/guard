package guardsched

import (
	"reflect"
	"testing"
)

func TestLoadRosterTypeCodesYAML_UIExportShape(t *testing.T) {
	raw := []byte(`
schema_version: 2
soldier_types:
  types:
    - { code: A, label: Type A }
soldiers:
  - { id: s0, full_name: S0, type_code: A }
  - { id: s1, full_name: S1, type_code: B }
`)
	got, err := LoadRosterTypeCodesYAML(raw, []string{"s0", "s1", "s2"})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"A", "B", ""}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

func TestLoadRosterTypeCodesYAML_LegacyNestedShape(t *testing.T) {
	raw := []byte(`
soldiers:
  soldiers:
    - { key: s0, type_code: A }
    - { id: s1, type_code: B }
`)
	got, err := LoadRosterTypeCodesYAML(raw, []string{"s0", "s1", "s2"})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"A", "B", ""}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

func TestLoadRosterTypeCodesYAML_MissingSoldiersList(t *testing.T) {
	raw := []byte("schema_version: 2\nsoldier_types: {}\n")
	_, err := LoadRosterTypeCodesYAML(raw, []string{"s0"})
	if err == nil {
		t.Fatal("expected error for missing soldiers list")
	}
}

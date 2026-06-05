package guardsched

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParseRulesText_Dv3Examples(t *testing.T) {
	zonesRaw, err := os.ReadFile(filepath.Join("..", "zones-dv3.yaml"))
	if err != nil {
		t.Skip("zones-dv3.yaml not in repo root")
	}
	zc, err := LoadZoneConfigYAML(zonesRaw, 10, nil)
	if err != nil {
		t.Fatal(err)
	}
	keys := []string{"s1", "s2", "s3", "s42", "s43"}
	lines := []string{
		"day:0 slot:1 shift:0 not:s1",
		"day:0 slot:1 shift:2 force:s42",
		"slot:1 shift:3 not:s1,s2,s3",
		"day:0 slot:6 shift:4 force_type:H",
		"day:0 slot:10 force_type:G",
		"day:0 slot:8 pin:3",
		"day:0 slot:8 type_remap G>H:2",
		"day:0 slot:1 shift:0 not:s1",
		"day:1 slot:1 shift:0 not:s1",
		"day:0 slot:8 pin:2",
		"day:0 slot:8 type_remap G>H:1",
	}
	text := ""
	for _, line := range lines {
		text += line + "\n"
	}
	cr, err := ParseRulesText(text, zc, keys, false)
	if err != nil {
		t.Fatal(err)
	}
	if cr == nil || len(cr.Rules) != len(lines) {
		t.Fatalf("got %d rules want %d", len(cr.Rules), len(lines))
	}
}

func TestParseRules_RejectForceTypeOnFullDayTeam(t *testing.T) {
	zonesRaw, err := os.ReadFile(filepath.Join("..", "zones-dv3.yaml"))
	if err != nil {
		t.Skip("zones-dv3.yaml not in repo root")
	}
	zc, err := LoadZoneConfigYAML(zonesRaw, 10, nil)
	if err != nil {
		t.Fatal(err)
	}
	_, err = ParseRulesText("day:0 slot:8 force_type:H", zc, []string{"s1"}, false)
	if err == nil {
		t.Fatal("expected error for force_type on full_day_team")
	}
}

func TestParseRules_RejectTypeRemapOnRotating(t *testing.T) {
	zonesRaw, err := os.ReadFile(filepath.Join("..", "zones-dv3.yaml"))
	if err != nil {
		t.Skip("zones-dv3.yaml not in repo root")
	}
	zc, err := LoadZoneConfigYAML(zonesRaw, 10, nil)
	if err != nil {
		t.Fatal(err)
	}
	_, err = ParseRulesText("day:0 slot:1 type_remap G>H:1", zc, []string{"s1"}, false)
	if err == nil {
		t.Fatal("expected error for type_remap on rotating slot")
	}
}

func TestResolveSlotID_NameAnd1Based(t *testing.T) {
	zonesRaw, err := os.ReadFile(filepath.Join("..", "zones-dv3.yaml"))
	if err != nil {
		t.Skip("zones-dv3.yaml not in repo root")
	}
	zc, err := LoadZoneConfigYAML(zonesRaw, 10, nil)
	if err != nil {
		t.Fatal(err)
	}
	idx, err := ResolveSlotID(zc, "hadas9")
	if err != nil || idx != 0 {
		t.Fatalf("hadas9 → 0, got %d err=%v", idx, err)
	}
	idx, err = ResolveSlotID(zc, 1)
	if err != nil || idx != 0 {
		t.Fatalf("1 → 0, got %d", idx)
	}
	idx, err = ResolveSlotID(zc, 8)
	if err != nil || idx != 7 {
		t.Fatalf("8 → 7 (carmel), got %d", idx)
	}
}

package guardsched

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type exampleFixtures struct {
	zone         *ZoneConfig
	keys         []string
	typeCodes    []string
	platoonCodes []string
}

func loadExampleFixtures(t *testing.T, rosterFile string) exampleFixtures {
	t.Helper()
	root := filepath.Join("..")
	zonesRaw, err := os.ReadFile(filepath.Join(root, "zones-example.yaml"))
	if err != nil {
		t.Skip("zones-example.yaml not in repo root")
	}
	rosterRaw, err := os.ReadFile(filepath.Join(root, rosterFile))
	if err != nil {
		t.Skip(rosterFile + " not in repo root")
	}
	zc, err := LoadZoneConfigYAML(zonesRaw, 10, nil)
	if err != nil {
		t.Fatal(err)
	}
	keys, err := LoadRosterSoldierIDsYAML(rosterRaw)
	if err != nil {
		t.Fatal(err)
	}
	typeCodes, err := LoadRosterTypeCodesYAML(rosterRaw, keys)
	if err != nil {
		t.Fatal(err)
	}
	platoonCodes, err := LoadRosterPlatoonCodesYAML(rosterRaw, keys)
	if err != nil {
		t.Fatal(err)
	}
	return exampleFixtures{zone: zc, keys: keys, typeCodes: typeCodes, platoonCodes: platoonCodes}
}

func runExampleSim(
	t *testing.T,
	fx exampleFixtures,
	days int,
	rulesText string,
	forceHard bool,
) ([]*AssignmentRecord, *CustomRuleSet) {
	t.Helper()
	anchor := time.Date(2026, 6, 5, 0, 0, 0, 0, time.UTC)
	seed := int64(42)
	var cr *CustomRuleSet
	var err error
	if strings.TrimSpace(rulesText) != "" {
		cr, err = ParseRulesText(rulesText, fx.zone, fx.keys, forceHard)
		if err != nil {
			t.Fatal(err)
		}
	}
	rng := NewPyRandom(seed)
	recs, _, err := RunSimulationZoneConfig(
		fx.zone, len(fx.keys), days, rng,
		6, true, 0, 2, 2, 0.2,
		5, nil, &anchor, fx.typeCodes, fx.platoonCodes, nil, cr,
	)
	if err != nil {
		t.Fatal(err)
	}
	return recs, cr
}

func soldierIdx(keys []string, id string) int {
	for i, k := range keys {
		if k == id {
			return i
		}
	}
	return -1
}

func assertAssigned(t *testing.T, recs []*AssignmentRecord, day, slot1, shift int, soldierID string, keys []string) {
	t.Helper()
	sidx := soldierIdx(keys, soldierID)
	slot0 := slot1 - 1
	for _, a := range recs {
		if a == nil || a.Day != day || a.Slot != slot0 {
			continue
		}
		if shift >= 0 && a.CalendarBlock != shift {
			continue
		}
		if a.SoldierIdx == sidx {
			return
		}
	}
	t.Fatalf("want %s at day=%d slot=%d shift=%d", soldierID, day, slot1, shift)
}

func assertNeverAssigned(t *testing.T, recs []*AssignmentRecord, soldierID string, keys []string) {
	t.Helper()
	sidx := soldierIdx(keys, soldierID)
	for _, a := range recs {
		if a != nil && a.SoldierIdx == sidx {
			t.Fatalf("%s assigned at day=%d slot=%d shift=%d kind=%s", soldierID, a.Day, a.Slot+1, a.CalendarBlock, a.Kind)
		}
	}
}

func assertNotAssigned(t *testing.T, recs []*AssignmentRecord, day, slot1, shift int, soldierID string, keys []string) {
	t.Helper()
	sidx := soldierIdx(keys, soldierID)
	slot0 := slot1 - 1
	for _, a := range recs {
		if a == nil || a.Day != day || a.Slot != slot0 {
			continue
		}
		if shift >= 0 && a.CalendarBlock != shift {
			continue
		}
		if a.Kind == "rotating" && a.SoldierIdx == sidx {
			t.Fatalf("%s assigned at day=%d slot=%d shift=%d", soldierID, day, slot1, shift)
		}
	}
}

func typeAtSlotDay(recs []*AssignmentRecord, day, slot0 int, keys, typeCodes []string) map[string]int {
	counts := map[string]int{}
	for _, a := range recs {
		if a == nil || a.Day != day || a.Slot != slot0 {
			continue
		}
		if a.SoldierIdx < 0 || a.SoldierIdx >= len(typeCodes) {
			continue
		}
		tc := strings.TrimSpace(typeCodes[a.SoldierIdx])
		if tc != "" {
			counts[tc]++
		}
	}
	return counts
}

func TestExampleNoExpertRules_MatchesGoldenSnapshot(t *testing.T) {
	fx := loadExampleFixtures(t, "roster-example.yaml")
	recs, _ := runExampleSim(t, fx, 1, "", false)
	got := NormalizeAssignments(recs)
	goldenPath := filepath.Join("..", "testdata", "expert_rules", "example_baseline_seed42.json")
	raw, err := os.ReadFile(goldenPath)
	if err != nil {
		t.Fatal(err)
	}
	var want []NormalizedAssignment
	if err := json.Unmarshal(raw, &want); err != nil {
		t.Fatal(err)
	}
	if len(got) != len(want) {
		t.Fatalf("assignment count %d != golden %d", len(got), len(want))
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("diff at %d: got %+v want %+v", i, got[i], want[i])
		}
	}
}

func TestExampleExpertRules_Not_OfficerMorningHadas9(t *testing.T) {
	fx := loadExampleFixtures(t, "roster-example.yaml")
	recs, _ := runExampleSim(t, fx, 1, "day:0 slot:1 shift:0 not:s1", false)
	assertNotAssigned(t, recs, 0, 1, 0, "s1", fx.keys)
}

func TestExampleExpertRules_Not_AllDaysSlot2(t *testing.T) {
	fx := loadExampleFixtures(t, "roster-example.yaml")
	recs, _ := runExampleSim(t, fx, 2, "slot:2 shift:1 not:s1,s2", false)
	for day := 0; day < 2; day++ {
		assertNotAssigned(t, recs, day, 2, 1, "s1", fx.keys)
		assertNotAssigned(t, recs, day, 2, 1, "s2", fx.keys)
	}
}

func TestExampleExpertRules_ForcePrefer_S42Afternoon(t *testing.T) {
	fx := loadExampleFixtures(t, "roster-example.yaml")
	recs, _ := runExampleSim(t, fx, 1, "day:0 slot:1 shift:2 force:s42", false)
	assertAssigned(t, recs, 0, 1, 2, "s42", fx.keys)
}

func TestExampleExpertRules_ForceHard_S43DespiteBusy(t *testing.T) {
	fx := loadExampleFixtures(t, "roster-example.yaml")
	rules := "day:0 slot:1 shift:2 not:s43\nday:0 slot:1 shift:2 force:s43"
	recs, cr := runExampleSim(t, fx, 1, rules, true)
	assertNotAssigned(t, recs, 0, 1, 2, "s43", fx.keys)
	if cr == nil || len(cr.ConflictsSlice()) == 0 {
		t.Fatal("expected rule_conflicts with not_blocks_force")
	}
	found := false
	for _, c := range cr.ConflictsSlice() {
		if c.Reason == "not_blocks_force" && c.Soldier == "s43" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("want not_blocks_force for s43, got %+v", cr.ConflictsSlice())
	}
}

func TestExampleExpertRules_ForceType_H_ValeroNight(t *testing.T) {
	fx := loadExampleFixtures(t, "roster-example.yaml")
	recs, _ := runExampleSim(t, fx, 1, "day:0 slot:6 shift:4 force_type:H", false)
	slot0 := 5
	for _, a := range recs {
		if a == nil || a.Day != 0 || a.Slot != slot0 || a.CalendarBlock != 4 {
			continue
		}
		if a.SoldierIdx < 0 || strings.TrimSpace(fx.typeCodes[a.SoldierIdx]) != "H" {
			t.Fatalf("slot 6 shift 4 assignee type want H, got idx %d", a.SoldierIdx)
		}
		return
	}
	t.Fatal("no assignment at slot 6 shift 4")
}

func TestExampleExpertRules_ForceType_E_KitchenFullDay(t *testing.T) {
	fx := loadExampleFixtures(t, "roster-example.yaml")
	recs, _ := runExampleSim(t, fx, 1, "day:0 slot:10 force_type:E", false)
	slot0 := 9
	for _, a := range recs {
		if a == nil || a.Day != 0 || a.Slot != slot0 {
			continue
		}
		if a.SoldierIdx < 0 || strings.TrimSpace(fx.typeCodes[a.SoldierIdx]) != "E" {
			t.Fatalf("kitchen assignee type want E, got idx %d", a.SoldierIdx)
		}
		return
	}
	t.Fatal("no kitchen assignment day 0")
}

func TestExampleExpertRules_Pin_Platoon3Carmel(t *testing.T) {
	fx := loadExampleFixtures(t, "roster-example.yaml")
	recs, _ := runExampleSim(t, fx, 1, "day:0 slot:8 pin:3", false)
	slot0 := 7
	platoon := ""
	for _, a := range recs {
		if a == nil || a.Day != 0 || a.Slot != slot0 {
			continue
		}
		if a.SoldierIdx < 0 || a.SoldierIdx >= len(fx.platoonCodes) {
			continue
		}
		p := strings.TrimSpace(fx.platoonCodes[a.SoldierIdx])
		if platoon == "" {
			platoon = p
		} else if p != platoon {
			t.Fatalf("mixed platoons on carmel: %s vs %s", platoon, p)
		}
	}
	if platoon != "3" {
		t.Fatalf("want platoon 3 on carmel, got %q", platoon)
	}
}

func TestExampleExpertRules_TypeRemap_GToH_Carmel(t *testing.T) {
	fx := loadExampleFixtures(t, "roster-example-sick.yaml")
	recs, _ := runExampleSim(t, fx, 1, "day:0 slot:8 type_remap G>H:2", false)
	counts := typeAtSlotDay(recs, 0, 7, fx.keys, fx.typeCodes)
	if counts["H"] < 2 {
		t.Fatalf("want at least 2 H on carmel, got %+v", counts)
	}
}

func TestExampleExpertRules_PinAndRemap_Combined(t *testing.T) {
	fx := loadExampleFixtures(t, "roster-example-sick.yaml")
	recs, _ := runExampleSim(t, fx, 1, "day:0 slot:8 pin:2\nday:0 slot:8 type_remap G>H:1", false)
	slot0 := 7
	platoon := ""
	for _, a := range recs {
		if a == nil || a.Day != 0 || a.Slot != slot0 {
			continue
		}
		p := strings.TrimSpace(fx.platoonCodes[a.SoldierIdx])
		if platoon == "" {
			platoon = p
		} else if p != platoon {
			t.Fatalf("mixed platoons: %s vs %s", platoon, p)
		}
	}
	if platoon != "2" {
		t.Fatalf("want platoon 2, got %q", platoon)
	}
	counts := typeAtSlotDay(recs, 0, slot0, fx.keys, fx.typeCodes)
	if counts["H"] < 1 {
		t.Fatalf("want at least 1 H after remap, got %+v", counts)
	}
}

func TestExampleExpertRules_MultiDay_NotMorning(t *testing.T) {
	fx := loadExampleFixtures(t, "roster-example.yaml")
	recs, _ := runExampleSim(t, fx, 2, "day:0 slot:1 shift:0 not:s1\nday:1 slot:1 shift:0 not:s1", false)
	for day := 0; day < 2; day++ {
		assertNotAssigned(t, recs, day, 1, 0, "s1", fx.keys)
	}
}

func TestExampleExpertRules_Exclude_Global(t *testing.T) {
	fx := loadExampleFixtures(t, "roster-example.yaml")
	recs, _ := runExampleSim(t, fx, 1, "exclude:s1", false)
	assertNeverAssigned(t, recs, "s1", fx.keys)
}

func TestExampleExpertRules_Exclude_DayScoped(t *testing.T) {
	fx := loadExampleFixtures(t, "roster-example.yaml")
	baseline, _ := runExampleSim(t, fx, 2, "", false)
	recs, _ := runExampleSim(t, fx, 2, "exclude:s1 day:0", false)
	assertNeverAssigned(t, filterRecsDay(recs, 0), "s1", fx.keys)
	// day 1 should still assign someone at slot 1 shift 0 (may or may not be s1)
	if len(filterRecsDay(baseline, 1)) == 0 || len(filterRecsDay(recs, 1)) == 0 {
		t.Fatal("expected assignments on day 1")
	}
}

func TestExampleExpertRules_Not_ShiftAllSlots(t *testing.T) {
	fx := loadExampleFixtures(t, "roster-example.yaml")
	recs, _ := runExampleSim(t, fx, 1, "not:s1 shift:0", false)
	for slot1 := 1; slot1 <= 5; slot1++ {
		assertNotAssigned(t, recs, 0, slot1, 0, "s1", fx.keys)
	}
}

func filterRecsDay(recs []*AssignmentRecord, day int) []*AssignmentRecord {
	var out []*AssignmentRecord
	for _, a := range recs {
		if a != nil && a.Day == day {
			out = append(out, a)
		}
	}
	return out
}

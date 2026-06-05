package guardsched

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDv3HotDay4AtMostOneRotatingPerSoldier(t *testing.T) {
	root := filepath.Join("..")
	zonesRaw, err := os.ReadFile(filepath.Join(root, "zones-dv3.yaml"))
	if err != nil {
		t.Skip("zones-dv3.yaml not in repo root")
	}
	rosterRaw, err := os.ReadFile(filepath.Join(root, "roster-dv3.yaml"))
	if err != nil {
		t.Skip("roster-dv3.yaml not in repo root")
	}
	zc, err := LoadZoneConfigYAML(zonesRaw, 10, nil)
	if err != nil {
		t.Fatal(err)
	}
	const nSoldiers = 79
	roster := Roster(nSoldiers)
	typeCodes, err := LoadRosterTypeCodesYAML(rosterRaw, roster)
	if err != nil {
		t.Fatal(err)
	}
	platoonCodes, err := LoadRosterPlatoonCodesYAML(rosterRaw, roster)
	if err != nil {
		t.Fatal(err)
	}
	anchor := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	seed := int64(42)
	tmp := t.TempDir()
	statePath := filepath.Join(tmp, "checkpoint.json")
	recs, _, _, err := RunSimulationHot(
		statePath, zc, nSoldiers, 4, 1, 1, &seed,
		6, 2, 2, 0.2, 5, nil, anchor, typeCodes, platoonCodes,
	)
	if err != nil {
		t.Fatal(err)
	}
	day := 3 // 2026-06-04
	rotBySoldier := map[int]int{}
	locTypesBySoldier := map[int]map[string]bool{}
	for _, a := range recs {
		if a.Kind != "rotating" || a.Day != day {
			continue
		}
		rotBySoldier[a.SoldierIdx]++
		if locTypesBySoldier[a.SoldierIdx] == nil {
			locTypesBySoldier[a.SoldierIdx] = map[string]bool{}
		}
		if a.Slot >= 0 && a.Slot < len(zc.Slots) {
			locI := zc.Slots[a.Slot].LocationIndex
			if locI >= 0 && locI < len(zc.Locations) {
				locTypesBySoldier[a.SoldierIdx][zc.Locations[locI].TypeID] = true
			}
		}
	}
	for sid, n := range rotBySoldier {
		if n > 1 {
			t.Fatalf("soldier s%d has %d rotating blocks on day %d (want <=1)", sid, n, day)
		}
		lt := locTypesBySoldier[sid]
		if lt["valero"] && lt["rotating_slot"] {
			t.Fatalf("soldier s%d has both valero and gate rotating on day %d", sid, day)
		}
	}
}

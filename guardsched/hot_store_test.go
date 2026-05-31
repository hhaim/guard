package guardsched

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestHotZonesS2ExtendOneDay(t *testing.T) {
	root := filepath.Join("..")
	zraw, _ := os.ReadFile(filepath.Join(root, "zones_s2.yaml"))
	rraw, _ := os.ReadFile(filepath.Join(root, "roaster1.yaml"))
	z, err := LoadZoneConfigYAML(zraw, 5, nil)
	if err != nil {
		t.Fatal(err)
	}
	keys := SoldierKeys(18)
	typeCodes, err := LoadRosterTypeCodesYAML(rraw, keys)
	if err != nil {
		t.Fatal(err)
	}
	anchor, _ := time.Parse("2006-01-02", "2026-05-27")
	anchor = time.Date(anchor.Year(), anchor.Month(), anchor.Day(), 0, 0, 0, 0, time.UTC)
	seed := int64(42)
	cold, err := RunSimulationZoneConfigWithContinuation(
		z, 18, 1, 1, NewPyRandom(seed),
		6, true, 0, 2, 2, 0.2, 5, nil, &anchor, typeCodes, &seed,
	)
	if err != nil {
		t.Fatal(err)
	}
	w, _, err := ExtendWitnessFromContinuation(cold.Continuation, cold.Records, keys)
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = RunSimulationZoneConfigExtend(
		z, 18, 1, 1, cold.Records, NewPyRandom(seed),
		6, true, 0, 2, 2, 0.2, 5, nil, &anchor, typeCodes, w,
	)
	if err != nil {
		t.Fatalf("extend: %v", err)
	}
}

func TestHotZonesS2ThreeDays(t *testing.T) {
	root := filepath.Join("..")
	zonesPath := filepath.Join(root, "zones_s2.yaml")
	rosterPath := filepath.Join(root, "roaster1.yaml")
	zraw, err := os.ReadFile(zonesPath)
	if err != nil {
		t.Fatal(err)
	}
	z, err := LoadZoneConfigYAML(zraw, 5, nil)
	if err != nil {
		t.Fatal(err)
	}
	rraw, err := os.ReadFile(rosterPath)
	if err != nil {
		t.Fatal(err)
	}
	keys := SoldierKeys(18)
	typeCodes, err := LoadRosterTypeCodesYAML(rraw, keys)
	if err != nil {
		t.Fatal(err)
	}
	anchor, err := time.Parse("2006-01-02", "2026-05-27")
	if err != nil {
		t.Fatal(err)
	}
	anchor = time.Date(anchor.Year(), anchor.Month(), anchor.Day(), 0, 0, 0, 0, time.UTC)
	storePath := filepath.Join(t.TempDir(), "checkpoint.json")
	seed := int64(42)
	for _, days := range []int{1, 2, 3} {
		if err := ClearHotStore(storePath); err != nil {
			t.Fatal(err)
		}
		_, _, _, err := RunSimulationHot(
			storePath, z, 18, days, 1, 1, &seed,
			6, 2, 2, 0.2, 5, nil, anchor, typeCodes,
		)
		if err != nil {
			t.Fatalf("days=%d: %v", days, err)
		}
		hist, err := LoadHotHistory(storePath, keys, z.ShiftHours)
		if err != nil {
			t.Fatal(err)
		}
		if hist.PrefixDays != days {
			t.Fatalf("days=%d store has %d plan days", days, hist.PrefixDays)
		}
	}
}

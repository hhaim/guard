package guardsched

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Reproduces DB history prefix (fixed historyDays window, sparse verified days) vs hot prefix.
func TestDV2SparseHistoryPrefixMissingFullDaySlots(t *testing.T) {
	root := findRepoRoot(t)
	zraw, err := os.ReadFile(filepath.Join(root, "zones-dv2.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	zc, err := LoadZoneConfigYAML(zraw, 11, nil)
	if err != nil {
		t.Fatal(err)
	}
	const nSoldiers = 80
	const historyDays = 14
	seed := int64(42)
	anchor := time.Date(2026, 6, 4, 0, 0, 0, 0, time.UTC) // Thursday plan anchor

	keys := SoldierKeys(nSoldiers)
	rraw, err := os.ReadFile(filepath.Join(root, "roster-dv2.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	typeCodes, err := LoadRosterTypeCodesYAML(rraw, keys)
	if err != nil {
		t.Fatal(err)
	}

	// One verified Wednesday (anchor-1) as if cold-generated and applied.
	wedAnchor := anchor.AddDate(0, 0, -1)
	rng := NewPyRandom(seed)
	cold, err := RunSimulationZoneConfigWithContinuation(
		zc, nSoldiers, 1, 1, rng,
		6, true, 0, 2, 2, 0.2,
		5, nil, &wedAnchor, typeCodes, nil, &seed,
	)
	if err != nil {
		t.Fatal(err)
	}
	wedRecs := cold.Records
	cont := cold.Continuation

	// DB-style: 14-day window, Wednesday at index historyDays-1 only.
	sparsePrefix := make([]*AssignmentRecord, 0, len(wedRecs))
	wedIdx := historyDays - 1
	for _, a := range wedRecs {
		if a == nil {
			continue
		}
		cp := *a
		cp.Day = wedIdx
		sparsePrefix = append(sparsePrefix, &cp)
	}

	witness, _, err := ExtendWitnessFromContinuation(cont, sparsePrefix, nil)
	if err != nil {
		t.Fatal(err)
	}

	extSparse, _, err := RunSimulationZoneConfigExtend(
		zc, nSoldiers, historyDays, 1, sparsePrefix, NewPyRandom(seed),
		6, true, 0, 2, 2, 0.2,
		5, nil, &anchor, typeCodes, nil, witness,
	)
	if err != nil {
		t.Fatalf("sparse extend: %v", err)
	}
	extSparse = ReindexExtendSegment(extSparse, historyDays)

	// Hot-style: prefixDays=1, Wednesday at day 0.
	hotPrefix := make([]*AssignmentRecord, 0, len(wedRecs))
	for _, a := range wedRecs {
		if a == nil {
			continue
		}
		cp := *a
		cp.Day = 0
		hotPrefix = append(hotPrefix, &cp)
	}
	witnessHot, _, err := ExtendWitnessFromContinuation(cont, hotPrefix, nil)
	if err != nil {
		t.Fatal(err)
	}
	extHot, _, err := RunSimulationZoneConfigExtend(
		zc, nSoldiers, 1, 1, hotPrefix, NewPyRandom(seed),
		6, true, 0, 2, 2, 0.2,
		5, nil, &anchor, typeCodes, nil, witnessHot,
	)
	if err != nil {
		t.Fatalf("hot extend: %v", err)
	}
	extHot = ReindexExtendSegment(extHot, 1)

	coldOnly, _, err := RunSimulationZoneConfig(
		zc, nSoldiers, 1, NewPyRandom(seed),
		6, true, 0, 2, 2, 0.2,
		5, nil, &anchor, typeCodes, nil, nil,
	)
	if err != nil {
		t.Fatal(err)
	}

	countSlots := func(recs []*AssignmentRecord) map[int]int {
		m := map[int]int{}
		for _, a := range recs {
			if a == nil || a.Day != 0 {
				continue
			}
			m[a.Slot]++
		}
		return m
	}

	sparseSlots := countSlots(extSparse)
	hotSlots := countSlots(extHot)
	coldSlots := countSlots(coldOnly)

	t.Logf("sparse slots: %v", sparseSlots)
	t.Logf("hot slots: %v", hotSlots)
	t.Logf("cold slots: %v", coldSlots)
	t.Logf("witness suffix len (sparse): %d skipNonrot=%v", len(witness.SuffixNonrot), len(witness.SuffixNonrot) > 0)

	for _, slot := range []int{8, 9, 10} { // carmel, rasar, kitchen (0-based 8,9,10)
		if coldSlots[slot] == 0 {
			t.Fatalf("cold baseline missing slot %d", slot+1)
		}
		if hotSlots[slot] == 0 {
			t.Fatalf("hot extend missing slot %d", slot+1)
		}
		if sparseSlots[slot] == 0 {
			t.Fatalf("sparse DB history extend missing slot %d (slots 9/10/11 in UI)", slot+1)
		}
	}
}

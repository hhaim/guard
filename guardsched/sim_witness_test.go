package guardsched

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

type witnessSplitLoadCase struct {
	zonesRel  string
	rosterRel string // empty = no roster type codes
	soldiers  int
	slots     int
	seed      int64
	end       int
	split     int
}

func runWitnessSplitLoadParity(t *testing.T, c witnessSplitLoadCase) {
	t.Helper()
	root := filepath.Join("..")
	zonesPath := filepath.Join(root, c.zonesRel)
	if _, err := os.Stat(zonesPath); err != nil {
		t.Skipf("%s not in repo root", c.zonesRel)
	}
	zraw, err := os.ReadFile(zonesPath)
	if err != nil {
		t.Fatal(err)
	}
	z, err := LoadZoneConfigYAML(zraw, c.slots, nil)
	if err != nil {
		t.Fatal(err)
	}
	var typeCodes []string
	if c.rosterRel != "" {
		rosterPath := filepath.Join(root, c.rosterRel)
		rraw, err := os.ReadFile(rosterPath)
		if err != nil {
			t.Fatal(err)
		}
		keys := SoldierKeys(c.soldiers)
		typeCodes, err = LoadRosterTypeCodesYAML(rraw, keys)
		if err != nil {
			t.Fatal(err)
		}
	}
	rng := NewPyRandom(c.seed)
	witness := &SimWitness{SplitDay: c.split}
	recs, _, err := RunSimulationZoneConfig(
		z, c.soldiers, c.end, rng,
		6, true, 0, 2, 2, 0.2,
		5, nil, nil, typeCodes, witness,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !witness.Captured {
		t.Fatal("witness not captured")
	}
	suffix := SuffixNonrotFromRecords(recs, c.split)
	prefix := filterDayLess(recs, c.split)
	extWitness := &ExtendWitness{
		RNGVersion: witness.RNGVersion, RNGState: witness.RNGState, SuffixNonrot: suffix,
	}
	rng2 := NewPyRandom(c.seed)
	ext, _, err := RunSimulationZoneConfigExtend(
		z, c.soldiers, c.split, c.end-c.split, prefix, rng2,
		6, true, 0, 2, 2, 0.2,
		5, nil, nil, typeCodes, extWitness,
	)
	if err != nil {
		t.Fatal(err)
	}
	// Extend returns new rotating rows only; suffix non-rot is replayed internally.
	merged := append(append([]*AssignmentRecord{}, prefix...), suffix...)
	merged = append(merged, ext...)
	coldSig, mergedSig := sigAssignments(recs), sigAssignments(merged)
	if len(coldSig) != len(mergedSig) {
		t.Fatalf("count cold=%d merged=%d", len(coldSig), len(mergedSig))
	}
	for i := range coldSig {
		if coldSig[i] != mergedSig[i] {
			t.Fatalf("diff at %d: cold=%s merged=%s", i, coldSig[i], mergedSig[i])
		}
	}
}

func TestWitnessSplitLoadZonesS2(t *testing.T) {
	runWitnessSplitLoadParity(t, witnessSplitLoadCase{
		zonesRel: "zones_s2.yaml", rosterRel: "roaster1.yaml",
		soldiers: 18, slots: 5, seed: 42, end: 14, split: 8,
	})
}

func TestWitnessSplitLoadZones4s(t *testing.T) {
	runWitnessSplitLoadParity(t, witnessSplitLoadCase{
		zonesRel: "zones_4s.yaml", rosterRel: "",
		soldiers: 12, slots: 4, seed: 42, end: 14, split: 8,
	})
}

func reindexExtend(ext []*AssignmentRecord, split int) []*AssignmentRecord {
	var out []*AssignmentRecord
	for _, a := range ext {
		if a == nil {
			continue
		}
		cp := *a
		cp.Day += split
		out = append(out, &cp)
	}
	return out
}

type assignSigRow struct {
	d, b, sl, si int
	k            string
}

func sigAssignments(recs []*AssignmentRecord) []string {
	var rows []assignSigRow
	for _, a := range recs {
		if a == nil {
			continue
		}
		k := a.Kind
		if k == "" {
			k = "rotating"
		}
		rows = append(rows, assignSigRow{a.Day, a.CalendarBlock, a.Slot, a.SoldierIdx, k})
	}
	// simple sort
	for i := 0; i < len(rows); i++ {
		for j := i + 1; j < len(rows); j++ {
			if lessRow(rows[j], rows[i]) {
				rows[i], rows[j] = rows[j], rows[i]
			}
		}
	}
	out := make([]string, len(rows))
	for i, r := range rows {
		out[i] = fmt.Sprintf("%d,%d,%d,%d,%s", r.d, r.b, r.sl, r.si, r.k)
	}
	return out
}

func lessRow(a, b assignSigRow) bool {
	if a.d != b.d {
		return a.d < b.d
	}
	if a.b != b.b {
		return a.b < b.b
	}
	if a.sl != b.sl {
		return a.sl < b.sl
	}
	return a.si < b.si
}

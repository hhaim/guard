package guardsched

import (
	"os"
	"path/filepath"
	"testing"
)

func TestContinuationMatchesCheckpointWitness(t *testing.T) {
	root := filepath.Join("..")
	zonesPath := filepath.Join(root, "zones_4s.yaml")
	zraw, err := os.ReadFile(zonesPath)
	if err != nil {
		t.Skip("zones_4s.yaml not in repo root")
	}
	const soldiers, slots, seed = 12, 4, int64(42)
	z, err := LoadZoneConfigYAML(zraw, slots, nil)
	if err != nil {
		t.Fatal(err)
	}
	end, split := 14, 8
	rng := NewPyRandom(seed)
	witness := &SimWitness{SplitDay: split}
	recs, _, err := RunSimulationZoneConfig(z, soldiers, end, rng, 6, true, 0, 2, 2, 0.2, 5, nil, nil, nil, nil, witness)
	if err != nil {
		t.Fatal(err)
	}
	if !witness.Captured {
		t.Fatal("witness not captured")
	}
	suffix := SuffixNonrotFromRecords(recs, split)
	prefix := filterDayLess(recs, split)
	rngJSON, err := snapshotWitnessRNG(witness)
	if err != nil {
		t.Fatal(err)
	}
	cont := &ContinuationSnapshot{
		FormatVersion: CheckpointFormatVersion,
		NumDays:       split,
		RNGState:      rngJSON,
		SuffixNonrot:  AssignmentRecordsToJSON(suffix, nil),
	}
	ckpt := cont.ToCheckpoint(prefix, nil)
	w2, pre2, err := ExtendWitnessFromCheckpoint(ckpt, SoldierKeys(soldiers))
	if err != nil {
		t.Fatal(err)
	}
	if w2 == nil || len(w2.RNGState) == 0 {
		t.Fatal("checkpoint witness missing")
	}
	if len(pre2) != len(prefix) {
		t.Fatalf("prefix len %d != %d", len(pre2), len(prefix))
	}
}

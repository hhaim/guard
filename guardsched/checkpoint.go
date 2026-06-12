package guardsched

import (
	"encoding/json"
	"fmt"
)

const CheckpointFormatVersion = 2
const CheckpointFormatVersionLegacy = 1

// CheckpointDocument is the on-disk checkpoint (v1 or v2).
type CheckpointDocument struct {
	FormatVersion int              `json:"format_version"`
	NumDays       int              `json:"num_days"`
	Assignments   []map[string]any `json:"assignments"`
	Seed          *int64           `json:"seed,omitempty"`
	RNGState      *RNGStateJSON    `json:"rng_state,omitempty"`
	SuffixNonrot  []map[string]any `json:"suffix_nonrot,omitempty"`
	TargetHorizon *int             `json:"target_horizon,omitempty"`
}

// ParseCheckpointJSON decodes a checkpoint file.
func ParseCheckpointJSON(raw []byte) (*CheckpointDocument, error) {
	var doc CheckpointDocument
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, err
	}
	if doc.FormatVersion != CheckpointFormatVersion && doc.FormatVersion != CheckpointFormatVersionLegacy {
		return nil, fmt.Errorf("unsupported checkpoint format_version %d", doc.FormatVersion)
	}
	if doc.NumDays < 1 {
		return nil, fmt.Errorf("checkpoint num_days must be >= 1")
	}
	return &doc, nil
}

// ExtendWitnessFromCheckpoint builds witness for extend when v2 fields are present.
func ExtendWitnessFromCheckpoint(doc *CheckpointDocument, keys []string) (*ExtendWitness, []*AssignmentRecord, error) {
	prefix := RecordsFromAssignmentJSON(doc.Assignments, keys)
	if doc.RNGState == nil {
		return nil, prefix, nil
	}
	ver, st, gauss, err := RNGStateFromJSON(*doc.RNGState)
	if err != nil {
		return nil, nil, err
	}
	w := &ExtendWitness{RNGVersion: ver, RNGState: st}
	if len(doc.SuffixNonrot) > 0 {
		w.SuffixNonrot = RecordsFromAssignmentJSON(doc.SuffixNonrot, keys)
	}
	_ = gauss
	return w, prefix, nil
}

package guardsched

import (
	"encoding/json"
	"fmt"
)

// ContinuationSnapshot is checkpoint v2 witness state stored on the last verified plan day.
// Same fields as CheckpointDocument witness payload; assignments live in per-day plan rows.
type ContinuationSnapshot struct {
	FormatVersion int              `json:"format_version"`
	NumDays       int              `json:"num_days"`
	RNGState      *RNGStateJSON    `json:"rng_state,omitempty"`
	SuffixNonrot  []map[string]any `json:"suffix_nonrot,omitempty"`
	TargetHorizon *int             `json:"target_horizon,omitempty"`
	Seed          *int64           `json:"seed,omitempty"`
}

// NewContinuationSnapshot builds v2 continuation after a sim run (extend or cold).
func NewContinuationSnapshot(
	r *PyRandom,
	horizonDays int,
	prefixRecords, segmentRecords []*AssignmentRecord,
	prefixDays, segmentDays int,
	seed *int64,
) (*ContinuationSnapshot, error) {
	if r == nil {
		return nil, fmt.Errorf("continuation: nil RNG")
	}
	if horizonDays < 1 {
		return nil, fmt.Errorf("continuation: horizon_days must be >= 1")
	}
	v, st, gauss := r.GetState()
	rngJSON, err := RNGStateToJSON(v, st, gauss)
	if err != nil {
		return nil, err
	}
	combined := append(append([]*AssignmentRecord{}, prefixRecords...), segmentRecords...)
	split := prefixDays + segmentDays
	suffix := SuffixNonrotFromRecords(combined, split)
	out := &ContinuationSnapshot{
		FormatVersion: CheckpointFormatVersion,
		NumDays:       horizonDays,
		RNGState:      rngJSON,
		SuffixNonrot:  AssignmentRecordsToJSON(suffix, nil),
		Seed:          seed,
	}
	if split > 0 {
		out.TargetHorizon = &split
	}
	return out, nil
}

// RNGStateToJSON encodes PyRandom state for storage.
func RNGStateToJSON(version int, state []uint32, gauss any) (*RNGStateJSON, error) {
	if version != 3 {
		return nil, fmt.Errorf("unsupported RNG version %d", version)
	}
	st := make([]int, len(state))
	for i, u := range state {
		st[i] = int(u)
	}
	return &RNGStateJSON{Version: version, State: st, Gauss: gauss}, nil
}

// ToCheckpoint builds a full checkpoint document for guardsim / tests from DB-shaped inputs.
func (c *ContinuationSnapshot) ToCheckpoint(prefix []*AssignmentRecord, keys []string) *CheckpointDocument {
	if c == nil {
		return nil
	}
	doc := &CheckpointDocument{
		FormatVersion: c.FormatVersion,
		NumDays:       c.NumDays,
		Assignments:   AssignmentRecordsToJSON(prefix, keys),
		Seed:          c.Seed,
		RNGState:      c.RNGState,
		SuffixNonrot:  c.SuffixNonrot,
		TargetHorizon: c.TargetHorizon,
	}
	if doc.FormatVersion == 0 {
		doc.FormatVersion = CheckpointFormatVersion
	}
	return doc
}

// ExtendWitnessFromContinuation maps stored continuation to extend witness.
func ExtendWitnessFromContinuation(c *ContinuationSnapshot, prefix []*AssignmentRecord, keys []string) (*ExtendWitness, []*AssignmentRecord, error) {
	if c == nil {
		return nil, prefix, nil
	}
	doc := c.ToCheckpoint(prefix, keys)
	return ExtendWitnessFromCheckpoint(doc, keys)
}

// ReindexExtendSegment maps extend output days [prefixDays..] to plan days [0..].
// Non-rotating extend rows use plan-relative days; rotating rows use absolute days (see normalizeExtendNewRecords).
func ReindexExtendSegment(recs []*AssignmentRecord, prefixDays int) []*AssignmentRecord {
	norm := normalizeExtendNewRecords(recs, prefixDays)
	out := make([]*AssignmentRecord, 0, len(norm))
	for _, a := range norm {
		if a == nil {
			continue
		}
		cp := *a
		cp.Day -= prefixDays
		if cp.Day < 0 {
			continue
		}
		out = append(out, &cp)
	}
	return out
}

// ContinuationFromPlanMeta extracts continuation from plan JSON meta or top-level field.
func ContinuationFromPlanJSON(raw []byte) (*ContinuationSnapshot, error) {
	var wrap struct {
		Continuation *ContinuationSnapshot `json:"continuation"`
		Meta         map[string]any        `json:"meta"`
	}
	if err := json.Unmarshal(raw, &wrap); err != nil {
		return nil, err
	}
	if wrap.Continuation != nil && wrap.Continuation.FormatVersion != 0 {
		return wrap.Continuation, nil
	}
	if wrap.Meta != nil {
		if c, ok := wrap.Meta["continuation"]; ok && c != nil {
			b, err := json.Marshal(c)
			if err != nil {
				return nil, err
			}
			var snap ContinuationSnapshot
			if err := json.Unmarshal(b, &snap); err != nil {
				return nil, err
			}
			if snap.FormatVersion != 0 {
				return &snap, nil
			}
		}
	}
	return nil, nil
}

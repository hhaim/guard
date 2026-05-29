package httpapi

import (
	"encoding/json"

	"guard/guardsched"
	"guard/internal/model"
)

func continuationFromSched(c *guardsched.ContinuationSnapshot) *model.SimContinuation {
	if c == nil {
		return nil
	}
	out := &model.SimContinuation{
		FormatVersion: c.FormatVersion,
		NumDays:       c.NumDays,
		SuffixNonrot:  c.SuffixNonrot,
		TargetHorizon: c.TargetHorizon,
		Seed:          c.Seed,
	}
	if c.RNGState != nil {
		b, _ := json.Marshal(c.RNGState)
		_ = json.Unmarshal(b, &out.RNGState)
	}
	return out
}

func continuationToSched(c *model.SimContinuation) (*guardsched.ContinuationSnapshot, error) {
	if c == nil || c.FormatVersion == 0 {
		return nil, nil
	}
	out := &guardsched.ContinuationSnapshot{
		FormatVersion: c.FormatVersion,
		NumDays:       c.NumDays,
		SuffixNonrot:  c.SuffixNonrot,
		TargetHorizon: c.TargetHorizon,
		Seed:          c.Seed,
	}
	if c.RNGState != nil {
		b, err := json.Marshal(c.RNGState)
		if err != nil {
			return nil, err
		}
		var rng guardsched.RNGStateJSON
		if err := json.Unmarshal(b, &rng); err != nil {
			return nil, err
		}
		out.RNGState = &rng
	}
	return out, nil
}

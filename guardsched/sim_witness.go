package guardsched

// SimWitness captures RNG at the split boundary during a cold simulation run.
type SimWitness struct {
	SplitDay      int
	RNGVersion    int
	RNGState      []uint32
	Captured      bool
	SuffixNonrot  []*AssignmentRecord
}

func maybeCaptureWitnessRNG(witness *SimWitness, day int, r *PyRandom) {
	if witness == nil || witness.Captured {
		return
	}
	if day+1 != witness.SplitDay {
		return
	}
	v, st, _ := r.GetState()
	witness.RNGVersion = v
	witness.RNGState = st
	witness.Captured = true
}

func filterDayLess(recs []*AssignmentRecord, split int) []*AssignmentRecord {
	var out []*AssignmentRecord
	for _, a := range recs {
		if a != nil && a.Day < split {
			cp := *a
			out = append(out, &cp)
		}
	}
	return out
}

// SuffixNonrotFromRecords returns non-rotating rows on days >= splitDay.
func SuffixNonrotFromRecords(recs []*AssignmentRecord, splitDay int) []*AssignmentRecord {
	var out []*AssignmentRecord
	for _, a := range recs {
		if a == nil || a.Day < splitDay {
			continue
		}
		k := a.Kind
		if k == "" {
			k = "rotating"
		}
		if k == "rotating" {
			continue
		}
		cp := *a
		out = append(out, &cp)
	}
	return out
}

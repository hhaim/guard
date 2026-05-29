package guardsched

import (
	"fmt"
	"time"
)

// ColdSimResult is a cold run with optional witness capture and continuation export.
type ColdSimResult struct {
	Records      []*AssignmentRecord
	Stats        *SimulationStats
	Continuation *ContinuationSnapshot
}

// RunSimulationZoneConfigWithContinuation runs a cold sim and exports continuation at horizonDays.
// When witnessSplit > 0, captures RNG at the split boundary (end of day witnessSplit-1).
func RunSimulationZoneConfigWithContinuation(
	zone *ZoneConfig,
	numSoldiers, horizonDays, witnessSplit int,
	r *PyRandom,
	minConsecutiveFreeHours float64,
	balanceTotalHours bool,
	totalHoursSlack float64,
	maxConsecutiveDutyBlocks int,
	minFreeShiftsAfterDuty int,
	bandRelative float64,
	planDayStartHour int,
	avail AvailabilityChecker,
	anchor *time.Time,
	typeCodes []string,
	seed *int64,
) (*ColdSimResult, error) {
	var witness *SimWitness
	if witnessSplit > 0 {
		witness = &SimWitness{SplitDay: witnessSplit}
	}
	recs, stats, err := RunSimulationZoneConfig(
		zone, numSoldiers, horizonDays, r,
		minConsecutiveFreeHours, balanceTotalHours, totalHoursSlack,
		maxConsecutiveDutyBlocks, minFreeShiftsAfterDuty, bandRelative,
		planDayStartHour, avail, anchor, typeCodes, witness,
	)
	if err != nil {
		return nil, err
	}
	prefix := filterDayLess(recs, witnessSplit)
	segment := make([]*AssignmentRecord, 0)
	for _, a := range recs {
		if a != nil && a.Day >= witnessSplit {
			cp := *a
			segment = append(segment, &cp)
		}
	}
	cont, err := NewContinuationSnapshot(r, horizonDays, prefix, segment, witnessSplit, horizonDays-witnessSplit, seed)
	if err != nil {
		return nil, err
	}
	if witness != nil && witness.Captured {
		cont.RNGState, err = snapshotWitnessRNG(witness)
		if err != nil {
			return nil, err
		}
		if len(witness.SuffixNonrot) > 0 {
			cont.SuffixNonrot = AssignmentRecordsToJSON(witness.SuffixNonrot, nil)
		} else {
			cont.SuffixNonrot = AssignmentRecordsToJSON(SuffixNonrotFromRecords(recs, witnessSplit), nil)
		}
	}
	return &ColdSimResult{Records: recs, Stats: stats, Continuation: cont}, nil
}

func snapshotWitnessRNG(witness *SimWitness) (*RNGStateJSON, error) {
	if witness == nil || !witness.Captured {
		return nil, fmt.Errorf("witness not captured")
	}
	return RNGStateToJSON(witness.RNGVersion, witness.RNGState, nil)
}

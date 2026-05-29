package guardsched

import (
	"fmt"
	"time"
)

// ExtendSimResult is extend output plus continuation for the next plan boundary.
type ExtendSimResult struct {
	Records      []*AssignmentRecord
	Stats        *SimulationStats
	Continuation *ContinuationSnapshot
}

// RunSimulationZoneConfigExtendWithContinuation runs extend (optional witness) and exports v2 continuation.
func RunSimulationZoneConfigExtendWithContinuation(
	zone *ZoneConfig,
	numSoldiers, prefixDays, extendDays int,
	prefixAssignments []*AssignmentRecord,
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
	witness *ExtendWitness,
	seed *int64,
) (*ExtendSimResult, error) {
	recs, stats, err := RunSimulationZoneConfigExtend(
		zone, numSoldiers, prefixDays, extendDays, prefixAssignments, r,
		minConsecutiveFreeHours, balanceTotalHours, totalHoursSlack,
		maxConsecutiveDutyBlocks, minFreeShiftsAfterDuty, bandRelative,
		planDayStartHour, avail, anchor, typeCodes, witness,
	)
	if err != nil {
		return nil, err
	}
	horizon := prefixDays + extendDays
	cont, err := NewContinuationSnapshot(r, horizon, prefixAssignments, recs, prefixDays, extendDays, seed)
	if err != nil {
		return nil, err
	}
	return &ExtendSimResult{Records: recs, Stats: stats, Continuation: cont}, nil
}

// RunSimulationBestOfZoneConfigExtendWitness is extend with optional witness; trials must be 1 when witness set.
func RunSimulationBestOfZoneConfigExtendWitness(
	zone *ZoneConfig,
	numSoldiers, prefixDays, extendDays, trials int,
	prefixAssignments []*AssignmentRecord,
	baseSeed *int64,
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
	witness *ExtendWitness,
) (recs []*AssignmentRecord, stats *SimulationStats, cont *ContinuationSnapshot, meta map[string]any, err error) {
	if trials < 1 {
		return nil, nil, nil, nil, fmt.Errorf("sim_trials must be >= 1")
	}
	if trials > 1 && baseSeed == nil {
		return nil, nil, nil, nil, fmt.Errorf("sim_trials > 1 requires seed")
	}
	if trials > 1 && witness != nil {
		return nil, nil, nil, nil, fmt.Errorf("sim_trials > 1 with witness not supported")
	}
	run := func(seed int64) (*ExtendSimResult, error) {
		rng := NewPyRandom(seed)
		return RunSimulationZoneConfigExtendWithContinuation(
			zone, numSoldiers, prefixDays, extendDays, prefixAssignments, rng,
			minConsecutiveFreeHours, balanceTotalHours, totalHoursSlack,
			maxConsecutiveDutyBlocks, minFreeShiftsAfterDuty, bandRelative,
			planDayStartHour, avail, anchor, typeCodes, witness, &seed,
		)
	}
	var seedUsed int64
	var result *ExtendSimResult
	if baseSeed == nil {
		seedUsed = 0
		result, err = run(0)
	} else {
		seedUsed = *baseSeed
		result, err = run(seedUsed)
	}
	if err != nil {
		return nil, nil, nil, nil, err
	}
	meta = map[string]any{
		"trials_run":     trials,
		"trial_index":    0,
		"trial_seed":     seedUsed,
		"fairness_score": fairnessScoreFromAssignments(result.Records, numSoldiers),
		"witness_extend": witness != nil && witness.RNGState != nil,
	}
	return result.Records, result.Stats, result.Continuation, meta, nil
}

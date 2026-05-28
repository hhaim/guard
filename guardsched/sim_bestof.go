package guardsched

import (
	"fmt"
	"math"
	"time"
)

// fairnessScoreFromAssignments returns stddev of per-soldier raw duty hours (lower is fairer).
func fairnessScoreFromAssignments(recs []*AssignmentRecord, numSoldiers int) float64 {
	if numSoldiers < 1 {
		return 0
	}
	totals := make([]float64, numSoldiers)
	for _, a := range recs {
		if a == nil || a.SoldierIdx < 0 || a.SoldierIdx >= numSoldiers {
			continue
		}
		totals[a.SoldierIdx] += a.RawHours
	}
	var sum, sumSq float64
	for _, v := range totals {
		sum += v
		sumSq += v * v
	}
	n := float64(numSoldiers)
	mean := sum / n
	variance := sumSq/n - mean*mean
	if variance < 0 {
		variance = 0
	}
	return math.Sqrt(variance)
}

// RunSimulationBestOfZoneConfig runs trials with seeds S, S+1, … and returns the lowest fairness_score run.
func RunSimulationBestOfZoneConfig(
	zone *ZoneConfig,
	numSoldiers, days, trials int,
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
) (recs []*AssignmentRecord, stats *SimulationStats, meta map[string]any, err error) {
	if trials < 1 {
		return nil, nil, nil, fmt.Errorf("sim_trials must be >= 1")
	}
	if trials > 1 && baseSeed == nil {
		return nil, nil, nil, fmt.Errorf("sim_trials > 1 requires seed")
	}
	run := func(seed int64) ([]*AssignmentRecord, *SimulationStats, error) {
		rng := NewPyRandom(seed)
		return RunSimulationZoneConfig(
			zone, numSoldiers, days, rng,
			minConsecutiveFreeHours, balanceTotalHours, totalHoursSlack,
			maxConsecutiveDutyBlocks, minFreeShiftsAfterDuty, bandRelative,
			planDayStartHour, avail, anchor, typeCodes,
		)
	}
	if trials == 1 {
		var seedUsed int64
		if baseSeed == nil {
			seedUsed = 0
			recs, stats, err = run(0)
		} else {
			seedUsed = *baseSeed
			recs, stats, err = run(seedUsed)
		}
		if err != nil {
			return nil, nil, nil, err
		}
		meta = map[string]any{
			"trials_run":    1,
			"trial_index":   0,
			"trial_seed":    seedUsed,
			"fairness_score": fairnessScoreFromAssignments(recs, numSoldiers),
		}
		return recs, stats, meta, nil
	}
	bestScore := math.Inf(1)
	bestTrial := 0
	bestSeed := *baseSeed
	for t := 0; t < trials; t++ {
		seedT := *baseSeed + int64(t)
		recsT, statsT, errT := run(seedT)
		if errT != nil {
			return nil, nil, nil, errT
		}
		score := fairnessScoreFromAssignments(recsT, numSoldiers)
		if score < bestScore {
			bestScore = score
			bestTrial = t
			bestSeed = seedT
			recs = recsT
			stats = statsT
		}
	}
	recs, stats, err = run(bestSeed)
	if err != nil {
		return nil, nil, nil, err
	}
	meta = map[string]any{
		"trials_run":     trials,
		"trial_index":    bestTrial,
		"trial_seed":     bestSeed,
		"fairness_score": fairnessScoreFromAssignments(recs, numSoldiers),
	}
	return recs, stats, meta, nil
}

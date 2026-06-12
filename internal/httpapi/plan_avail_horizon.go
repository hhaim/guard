package httpapi

// planAvailHorizonDays returns how many plan-day offsets the availability checker
// must cover for a schedule simulation run.
//
// Witness extend only simulates new plan days (availability offset handled in sim),
// so planDays is enough. Bootstrap cold re-simulates prefixDays+planDays from day 0
// and needs availability for the full horizon.
func planAvailHorizonDays(planDays, prefixDays int, hasHistory, useWitnessExtend bool) int {
	if planDays < 1 {
		planDays = 1
	}
	if !hasHistory || useWitnessExtend {
		return planDays
	}
	if prefixDays < 0 {
		prefixDays = 0
	}
	return prefixDays + planDays
}

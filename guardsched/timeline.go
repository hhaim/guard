package guardsched

// BuildUnavailTimelineTensor returns unavail[day][soldier][block] when the soldier cannot
// be assigned that block (away/sick/training/etc.). Used for timeline charts (yellow segments).
func BuildUnavailTimelineTensor(
	avail AvailabilityChecker,
	days, numSoldiers, blocksPerDay, planDayStartHour int,
	shiftHours float64,
) [][][]bool {
	if avail == nil || days < 1 || numSoldiers < 1 || blocksPerDay < 1 {
		return nil
	}
	out := make([][][]bool, days)
	for d := 0; d < days; d++ {
		out[d] = make([][]bool, numSoldiers)
		for s := 0; s < numSoldiers; s++ {
			out[d][s] = make([]bool, blocksPerDay)
			for b := 0; b < blocksPerDay; b++ {
				out[d][s][b] = !avail.AvailRotatingBlock(s, d, b, planDayStartHour, shiftHours)
			}
		}
	}
	return out
}

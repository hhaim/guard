package guardsched

import "time"

// AvailabilityChecker gates soldier assignment by duty-span availability.
// When nil, all roster soldiers are treated as available (legacy behavior).
type AvailabilityChecker interface {
	AvailIdx(idx, day int, dutyStart, dutyEnd time.Time) bool
	AvailDutyWallHours(idx, day, h0, h1 int) bool
	AvailRotatingBlock(idx, day, block int, planDayStartHour int, shiftHours float64) bool
}

func soldierAvail(avail AvailabilityChecker, idx, day int, check func() bool) bool {
	if avail == nil {
		return true
	}
	return check()
}

package guardsched

import "time"

// NowFakeUTC returns the current Asia/Jerusalem wall clock reinterpreted as UTC
// (no timezone conversion). Use when comparing against stored schedule/status times.
func NowFakeUTC() time.Time {
	loc, _ := time.LoadLocation("Asia/Jerusalem")
	local := time.Now().In(loc)
	return time.Date(
		local.Year(), local.Month(), local.Day(),
		local.Hour(), local.Minute(), local.Second(), 0,
		time.UTC,
	)
}

// TodayFakeUTC returns midnight on the fake-UTC calendar date of NowFakeUTC().
func TodayFakeUTC() time.Time {
	n := NowFakeUTC()
	return time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, time.UTC)
}

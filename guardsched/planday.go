package guardsched

import (
	"fmt"
	"strconv"
	"strings"
)

const DefaultPlanDayStart = "05:00"

// ParsePlanDayStart parses "HH:MM" (whole hours only; minutes must be 00).
func ParsePlanDayStart(s string) (hour int, err error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 5, nil
	}
	parts := strings.Split(s, ":")
	if len(parts) != 2 {
		return 0, fmt.Errorf("plan_day_start: expected HH:MM, got %q", s)
	}
	h, err := strconv.Atoi(strings.TrimSpace(parts[0]))
	if err != nil || h < 0 || h > 23 {
		return 0, fmt.Errorf("plan_day_start: hour must be 0–23, got %q", parts[0])
	}
	m, err := strconv.Atoi(strings.TrimSpace(parts[1]))
	if err != nil || m != 0 {
		return 0, fmt.Errorf("plan_day_start: minutes must be 00, got %q", parts[1])
	}
	return h, nil
}

// BlockStartHour returns wall-clock hour for a rotating calendar block.
func BlockStartHour(planStart int, block int, shiftHours float64) int {
	h := planStart + int(float64(block)*shiftHours)
	h %= 24
	if h < 0 {
		h += 24
	}
	return h
}

// WeekdayLongName returns English weekday name for t (UTC calendar date).
func WeekdayLongName(w int) string {
	names := []string{"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"}
	if w < 0 || w > 6 {
		return ""
	}
	return names[w]
}

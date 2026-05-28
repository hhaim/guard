package guardsched

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
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

// WeekdayLongNameLower returns lowercase English weekday (sunday..saturday).
func WeekdayLongNameLower(w int) string {
	n := WeekdayLongName(w)
	if n == "" {
		return ""
	}
	return strings.ToLower(n)
}

var weekdayNameToIndex = func() map[string]int {
	m := make(map[string]int)
	for i := 0; i < 7; i++ {
		m[WeekdayLongNameLower(i)] = i
	}
	return m
}()

// ParseWeekdayName maps a weekday string (case-insensitive) to 0=Sunday..6=Saturday.
func ParseWeekdayName(s string) (int, error) {
	key := strings.ToLower(strings.TrimSpace(s))
	if key == "" {
		return 0, fmt.Errorf("empty weekday name")
	}
	if i, ok := weekdayNameToIndex[key]; ok {
		return i, nil
	}
	return 0, fmt.Errorf("invalid weekday name %q (use sunday..saturday)", s)
}

// ParseDisabledWeekdays parses YAML disabled_weekdays list; returns unique sorted indices.
func ParseDisabledWeekdays(raw any) ([]int, error) {
	if raw == nil {
		return nil, nil
	}
	list, ok := raw.([]any)
	if !ok {
		return nil, fmt.Errorf("disabled_weekdays must be a list")
	}
	seen := map[int]bool{}
	var out []int
	for _, item := range list {
		i, err := ParseWeekdayName(fmt.Sprint(item))
		if err != nil {
			return nil, err
		}
		if !seen[i] {
			seen[i] = true
			out = append(out, i)
		}
	}
	sort.Ints(out)
	return out, nil
}

// WeekdayForAnchorPlanDay returns weekday index for plan day offset d from anchor (UTC calendar date at 00:00).
// Prefer WeekdayAtPlanDayStart when plan_day_start is not midnight.
func WeekdayForAnchorPlanDay(anchor time.Time, planDay int) int {
	return WeekdayAtPlanDayStart(anchor, planDay, 0)
}

// WeekdayAtPlanDayStart returns 0=Sunday..6=Saturday for the instant plan day d begins
// (anchor calendar date + d days at planStartHour UTC). Use this for disabled_weekdays so
// duties that cross midnight (e.g. 05:00–next 05:00) match the weekday at shift start.
func WeekdayAtPlanDayStart(anchor time.Time, planDay, planStartHour int) int {
	planStartHour %= 24
	if planStartHour < 0 {
		planStartHour += 24
	}
	y, m, d := anchor.Date()
	t := time.Date(y, m, d, 0, 0, 0, 0, time.UTC).AddDate(0, 0, planDay)
	t = t.Add(time.Duration(planStartHour) * time.Hour)
	return int(t.Weekday())
}

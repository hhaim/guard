package guardsched

import (
	"fmt"
	"strings"
)

// parseTimeBandBound converts YAML from_hour / to_hour (int hour shorthand or "HH:MM") to minutes [0,1440].
func parseTimeBandBound(v any) (int, error) {
	if v == nil {
		return 0, fmt.Errorf("time band bound is required")
	}
	switch x := v.(type) {
	case int:
		return timeBandMinutesFromInt(x)
	case int64:
		return timeBandMinutesFromInt(int(x))
	case float64:
		h := int(x)
		if float64(h) != x {
			return 0, fmt.Errorf("time band bound %v must be a whole hour", v)
		}
		return timeBandMinutesFromInt(h)
	case string:
		h, err := parseHHMMClock(x)
		if err != nil {
			return 0, err
		}
		return h * 60, nil
	default:
		s := strings.TrimSpace(fmt.Sprint(v))
		if s == "" || s == "<nil>" {
			return 0, fmt.Errorf("time band bound is required")
		}
		h, err := parseHHMMClock(s)
		if err != nil {
			return 0, err
		}
		return h * 60, nil
	}
}

// timeBandMinutesFromInt converts YAML int shorthand (0..24) or sexagesimal minutes (e.g. unquoted 22:00 → 1320).
func timeBandMinutesFromInt(x int) (int, error) {
	if x >= 0 && x <= 24 {
		return x * 60, nil
	}
	if x > 24 && x <= 1440 && x%60 == 0 {
		return x, nil
	}
	return 0, fmt.Errorf("time band bound %d out of range", x)
}

// parseClockHour extracts 0..24 from YAML clock values (string "HH:MM", int hour, or sexagesimal minutes).
func parseClockHour(v any) (int, error) {
	if v == nil {
		return 0, fmt.Errorf("clock value is required")
	}
	switch x := v.(type) {
	case int:
		return clockHourFromInt(x)
	case int64:
		return clockHourFromInt(int(x))
	case float64:
		h := int(x)
		if float64(h) != x {
			return 0, fmt.Errorf("clock value %v must be a whole hour", v)
		}
		return clockHourFromInt(h)
	case string:
		return parseHHMMClock(x)
	default:
		s := strings.TrimSpace(fmt.Sprint(v))
		if s == "" || s == "<nil>" {
			return 0, fmt.Errorf("clock value is required")
		}
		return parseHHMMClock(s)
	}
}

func clockHourFromInt(x int) (int, error) {
	if x >= 0 && x <= 24 {
		return x, nil
	}
	if x > 24 && x <= 1440 && x%60 == 0 {
		return x / 60, nil
	}
	return 0, fmt.Errorf("invalid clock hour value %d", x)
}

// timeBandContainsStartMin reports whether wall-clock minute startMin falls in [fromMin, toExclMin) (wrap when from >= to).
func timeBandContainsStartMin(fromMin, toExclMin, startMin int) bool {
	startMin = ((startMin % 1440) + 1440) % 1440
	if fromMin < toExclMin {
		return startMin >= fromMin && startMin < toExclMin
	}
	if fromMin == toExclMin {
		return false
	}
	return startMin >= fromMin || startMin < toExclMin
}

// timeBandSpanHours returns the length of [fromMin, toExclMin) in hours (supports wrap and end-of-day 1440).
func timeBandSpanHours(fromMin, toExclMin int) float64 {
	var span int
	if fromMin < toExclMin {
		span = toExclMin - fromMin
	} else if fromMin == toExclMin {
		return 0
	} else {
		span = 1440 - fromMin + toExclMin
	}
	return float64(span) / 60.0
}

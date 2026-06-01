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
		return x * 60, nil
	case int64:
		return int(x) * 60, nil
	case float64:
		h := int(x)
		if float64(h) != x {
			return 0, fmt.Errorf("time band bound %v must be a whole hour", v)
		}
		return h * 60, nil
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

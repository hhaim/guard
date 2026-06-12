package guardsched

import "encoding/json"

// RecordsFromAssignmentJSON rebuilds assignment records from proposal/API assignment maps.
func RecordsFromAssignmentJSON(assigns []map[string]any, soldierKeys []string) []*AssignmentRecord {
	idx := make(map[string]int, len(soldierKeys))
	for i, k := range soldierKeys {
		idx[k] = i
	}
	var out []*AssignmentRecord
	for _, m := range assigns {
		si := intFromJSON(m["soldier_idx"])
		if sid, ok := m["soldier_id"].(string); ok && sid != "" {
			if j, ok := idx[sid]; ok {
				si = j
			}
		}
		kind := stringFromJSON(m["kind"])
		if kind == "" {
			kind = "rotating"
		}
		rec := &AssignmentRecord{
			Day:                  intFromJSON(m["day"]),
			CalendarBlock:        intFromJSON(m["calendar_block"]),
			StartHour:            intFromJSON(m["start_hour"]),
			Slot:                 intFromJSON(m["slot"]),
			SoldierIdx:           si,
			LocI:                 intFromJSON(m["loc_i"]),
			TimeJ:                intFromJSON(m["time_j"]),
			Weight:               floatFromJSON(m["weight"]),
			RawHours:             floatFromJSON(m["raw_hours"]),
			Kind:                 kind,
			Rowspan:              intFromJSON(m["rowspan"]),
			WinStartBlock:        intFromJSON(m["win_start_block"]),
			WinEndBlock:          intFromJSON(m["win_end_block"]),
			WindowName:           stringFromJSON(m["window_name"]),
			LinearBusySpanBlocks: intFromJSON(m["linear_busy_span_blocks"]),
		}
		if rec.Rowspan == 0 {
			rec.Rowspan = 1
		}
		out = append(out, rec)
	}
	return out
}

func intFromJSON(v any) int {
	switch x := v.(type) {
	case float64:
		return int(x)
	case int:
		return x
	case int64:
		return int(x)
	case json.Number:
		i, _ := x.Int64()
		return int(i)
	default:
		return 0
	}
}

func floatFromJSON(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case int:
		return float64(x)
	case int64:
		return float64(x)
	case json.Number:
		f, _ := x.Float64()
		return f
	default:
		return 0
	}
}

func stringFromJSON(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

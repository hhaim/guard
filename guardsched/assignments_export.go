package guardsched

// AssignmentRecordsToJSON maps simulation records to JSON-friendly dicts (Python-compatible fields).
func AssignmentRecordsToJSON(recs []*AssignmentRecord, soldierKeys []string) []map[string]any {
	out := make([]map[string]any, 0, len(recs))
	for _, a := range recs {
		if a == nil {
			continue
		}
		d := map[string]any{
			"day":              a.Day,
			"calendar_block":   a.CalendarBlock,
			"start_hour":       a.StartHour,
			"slot":             a.Slot,
			"soldier_idx":      a.SoldierIdx,
			"loc_i":            a.LocI,
			"time_j":           a.TimeJ,
			"weight":           a.Weight,
			"raw_hours":        a.RawHours,
			"kind":             a.Kind,
			"rowspan":          a.Rowspan,
			"win_start_block":  a.WinStartBlock,
			"win_end_block":    a.WinEndBlock,
		}
		if a.SoldierIdx >= 0 && a.SoldierIdx < len(soldierKeys) {
			d["soldier_id"] = soldierKeys[a.SoldierIdx]
		}
		if a.WindowName != "" {
			d["window_name"] = a.WindowName
		}
		if a.LinearBusySpanBlocks > 0 {
			d["linear_busy_span_blocks"] = a.LinearBusySpanBlocks
		}
		out = append(out, d)
	}
	return out
}

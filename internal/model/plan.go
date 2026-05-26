package model

import (
	"encoding/json"
	"fmt"
	"sort"
	"time"
)

const PlanFormatVersion = 1

// PlanChange is one manual edit recorded on a proposal.
type PlanChange struct {
	TsDate       string `json:"ts_date"`
	Slot         string `json:"slot"`
	ShiftIndex   int    `json:"shift_index"`
	ShiftLabel   string `json:"shift_label,omitempty"`
	OldSoldierID string `json:"old_soldier_id"`
	NewSoldierID string `json:"new_soldier_id"`
}

// PlanDoc is the planning / verified-schedule JSON document (one or more calendar days).
type PlanDoc struct {
	FormatVersion int              `json:"format_version"`
	AnchorDate    string           `json:"anchor_date"`
	Days          int              `json:"days"`
	ShiftHours    float64          `json:"shift_hours"`
	Assignments   []map[string]any `json:"assignments"`
	Meta          map[string]any   `json:"meta,omitempty"`
	Changes       []PlanChange     `json:"changes,omitempty"`
	UpdatedAt     string           `json:"updated_at,omitempty"`
}

// ScheduleDay is one persisted calendar day in the schedule table.
type ScheduleDay struct {
	TsDate          time.Time
	Plan            PlanDoc
	AppliedFromSlot string
}

// SplitPlanByDate splits a multi-day proposal into one PlanDoc per calendar date.
func SplitPlanByDate(doc PlanDoc) ([]ScheduleDay, error) {
	anchor, err := time.Parse("2006-01-02", doc.AnchorDate)
	if err != nil {
		return nil, fmt.Errorf("invalid anchor_date: %w", err)
	}
	anchor = time.Date(anchor.Year(), anchor.Month(), anchor.Day(), 0, 0, 0, 0, time.UTC)

	byDate := make(map[string][]map[string]any)
	for _, a := range doc.Assignments {
		day := intFromAny(a["day"])
		ts := anchor.AddDate(0, 0, day)
		key := ts.Format("2006-01-02")
		cp := make(map[string]any, len(a)+1)
		for k, v := range a {
			cp[k] = v
		}
		cp["day"] = 0
		byDate[key] = append(byDate[key], cp)
	}

	dates := make([]string, 0, len(byDate))
	for d := range byDate {
		dates = append(dates, d)
	}
	sort.Strings(dates)

	out := make([]ScheduleDay, 0, len(dates))
	for _, d := range dates {
		ts, err := time.Parse("2006-01-02", d)
		if err != nil {
			return nil, err
		}
		dayDoc := PlanDoc{
			FormatVersion: doc.FormatVersion,
			AnchorDate:    d,
			Days:          1,
			ShiftHours:    doc.ShiftHours,
			Assignments:   byDate[d],
			Meta:          doc.Meta,
			Changes:       doc.Changes,
		}
		if dayDoc.FormatVersion == 0 {
			dayDoc.FormatVersion = PlanFormatVersion
		}
		out = append(out, ScheduleDay{
			TsDate: time.Date(ts.Year(), ts.Month(), ts.Day(), 0, 0, 0, 0, time.UTC),
			Plan:   dayDoc,
		})
	}
	return out, nil
}

// MergeScheduleDays builds one PlanDoc for a date range from per-day rows.
func MergeScheduleDays(from time.Time, days []ScheduleDay) (PlanDoc, error) {
	if len(days) == 0 {
		return PlanDoc{
			FormatVersion: PlanFormatVersion,
			AnchorDate:    from.Format("2006-01-02"),
			Days:          0,
			Assignments:   nil,
		}, nil
	}
	sort.Slice(days, func(i, j int) bool {
		return days[i].TsDate.Before(days[j].TsDate)
	})

	shiftHours := days[0].Plan.ShiftHours
	var merged []map[string]any
	for i, d := range days {
		if d.Plan.ShiftHours != shiftHours {
			return PlanDoc{}, fmt.Errorf("shift_hours mismatch on %s", d.TsDate.Format("2006-01-02"))
		}
		for _, a := range d.Plan.Assignments {
			cp := make(map[string]any, len(a)+1)
			for k, v := range a {
				cp[k] = v
			}
			cp["day"] = i
			merged = append(merged, cp)
		}
	}
	fv := days[0].Plan.FormatVersion
	if fv == 0 {
		fv = PlanFormatVersion
	}
	return PlanDoc{
		FormatVersion: fv,
		AnchorDate:    from.Format("2006-01-02"),
		Days:          len(days),
		ShiftHours:    shiftHours,
		Assignments:   merged,
	}, nil
}

// BlocksBySoldierDate counts one block per assignment in stored day plans.
func BlocksBySoldierDate(days []ScheduleDay) []SoldierDateBlocks {
	type key struct {
		soldier string
		date    string
	}
	counts := make(map[key]int64)
	for _, d := range days {
		date := d.TsDate.Format("2006-01-02")
		for _, a := range d.Plan.Assignments {
			sid := stringFromAny(a["soldier_id"])
			if sid == "" {
				if idx := intFromAny(a["soldier_idx"]); idx >= 0 {
					sid = fmt.Sprintf("s%d", idx)
				}
			}
			if sid == "" {
				continue
			}
			counts[key{soldier: sid, date: date}]++
		}
	}
	type row struct {
		soldier string
		date    string
		blocks  int64
	}
	var rows []row
	for k, n := range counts {
		rows = append(rows, row{soldier: k.soldier, date: k.date, blocks: n})
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].date != rows[j].date {
			return rows[i].date < rows[j].date
		}
		return rows[i].soldier < rows[j].soldier
	})
	out := make([]SoldierDateBlocks, len(rows))
	for i, r := range rows {
		ts, _ := time.Parse("2006-01-02", r.date)
		out[i] = SoldierDateBlocks{SoldierID: r.soldier, TsDate: ts, Blocks: r.blocks}
	}
	return out
}

// SoldierDateBlocks is one fairness aggregate row for reports.
type SoldierDateBlocks struct {
	SoldierID string
	TsDate    time.Time
	Blocks    int64
}

func intFromAny(v any) int {
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

func stringFromAny(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

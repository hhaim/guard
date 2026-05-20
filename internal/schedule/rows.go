package schedule

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"

	"guard/guardsched"
)

// PersistInput carries DB-ready schedule rows for one run.
type PersistInput struct {
	AnchorDate   time.Time
	BlockHours   float64
	BlocksPerDay int
	SoldierKeys  []string // index -> soldier id (e.g. s0)
	SlotLabels   []string // slot index -> label
	Records      []*guardsched.AssignmentRecord
}

// ScheduleRow matches the schedule table (without id).
type ScheduleRow struct {
	TsDate     time.Time
	DayIndex   int
	Slot       string
	ShiftIndex int
	ShiftStart time.Time
	ShiftEnd   time.Time
	SoldierID  string
	Meta       json.RawMessage
}

// ToScheduleRows flattens simulation records into DB rows.
func ToScheduleRows(in PersistInput) ([]ScheduleRow, error) {
	if len(in.SoldierKeys) == 0 {
		return nil, fmt.Errorf("soldier keys required")
	}
	var out []ScheduleRow
	for _, a := range in.Records {
		if a.SoldierIdx < 0 || a.SoldierIdx >= len(in.SoldierKeys) {
			return nil, fmt.Errorf("soldier idx %d out of range", a.SoldierIdx)
		}
		sid := in.SoldierKeys[a.SoldierIdx]
		slotLabel := slotName(in.SlotLabels, a.Slot)
		dayTime := in.AnchorDate.AddDate(0, 0, a.Day)
		tsDate := time.Date(dayTime.Year(), dayTime.Month(), dayTime.Day(), 0, 0, 0, 0, time.UTC)

		kind := a.Kind
		if kind == "" {
			kind = "rotating"
		}
		meta, err := json.Marshal(map[string]any{
			"kind": kind, "loc_i": a.LocI, "time_j": a.TimeJ, "weight": a.Weight,
			"raw_hours": a.RawHours, "window": a.WindowName,
			"rowspan": a.Rowspan, "win_start_block": a.WinStartBlock, "win_end_block": a.WinEndBlock,
		})
		if err != nil {
			return nil, err
		}

		t0 := wallClock(a.StartHour, 0, 0)
		var t1 time.Time
		switch kind {
		case "rotating":
			t1 = t0.Add(time.Duration(math.Round(in.BlockHours*60)) * time.Minute)
		default:
			t1 = t0.Add(time.Duration(math.Round(a.RawHours*60)) * time.Minute)
		}

		out = append(out, ScheduleRow{
			TsDate: tsDate, DayIndex: a.Day + 1, Slot: slotLabel, ShiftIndex: a.CalendarBlock,
			ShiftStart: t0, ShiftEnd: t1, SoldierID: sid, Meta: meta,
		})
	}
	return out, nil
}

func slotName(labels []string, slot int) string {
	if slot >= 0 && slot < len(labels) {
		l := strings.TrimSpace(labels[slot])
		if l != "" && l != "<nil>" {
			return l
		}
	}
	return fmt.Sprintf("SLOT%d", slot)
}

func wallClock(h, m, s int) time.Time {
	h = h % 24
	if h < 0 {
		h += 24
	}
	return time.Date(2000, 1, 1, h, m, s, 0, time.UTC)
}

// ReverseInput maps persisted schedule rows back to simulation records.
type ReverseInput struct {
	AnchorDate   time.Time
	BlockHours   float64
	SoldierKeys  []string
	SlotLabels   []string
	Rows         []ScheduleRow
}

// FromScheduleRows converts DB rows into assignment records (inverse of ToScheduleRows).
func FromScheduleRows(in ReverseInput) ([]*guardsched.AssignmentRecord, error) {
	anchor := time.Date(in.AnchorDate.Year(), in.AnchorDate.Month(), in.AnchorDate.Day(), 0, 0, 0, 0, time.UTC)
	soldierIdx := make(map[string]int, len(in.SoldierKeys))
	for i, k := range in.SoldierKeys {
		soldierIdx[k] = i
	}
	slotIdx := make(map[string]int, len(in.SlotLabels))
	for i, label := range in.SlotLabels {
		slotIdx[label] = i
	}

	var out []*guardsched.AssignmentRecord
	for _, r := range in.Rows {
		si, ok := soldierIdx[r.SoldierID]
		if !ok {
			return nil, fmt.Errorf("unknown soldier_id %q", r.SoldierID)
		}
		sl, ok := slotIdx[r.Slot]
		if !ok {
			sl = -1
			for i, label := range in.SlotLabels {
				if label == r.Slot {
					sl = i
					ok = true
					break
				}
			}
			if !ok {
				return nil, fmt.Errorf("unknown slot %q", r.Slot)
			}
		}

		day := r.DayIndex - 1
		if r.DayIndex <= 0 {
			ts := time.Date(r.TsDate.Year(), r.TsDate.Month(), r.TsDate.Day(), 0, 0, 0, 0, time.UTC)
			day = int(ts.Sub(anchor).Hours() / 24)
		}
		if day < 0 {
			return nil, fmt.Errorf("ts_date %s before anchor", r.TsDate.Format("2006-01-02"))
		}

		var meta struct {
			Kind          string  `json:"kind"`
			LocI          int     `json:"loc_i"`
			TimeJ         int     `json:"time_j"`
			Weight        float64 `json:"weight"`
			RawHours      float64 `json:"raw_hours"`
			Window        string  `json:"window"`
			Rowspan       int     `json:"rowspan"`
			WinStartBlock int     `json:"win_start_block"`
			WinEndBlock   int     `json:"win_end_block"`
		}
		if len(r.Meta) > 0 {
			_ = json.Unmarshal(r.Meta, &meta)
		}
		kind := meta.Kind
		if kind == "" {
			kind = "rotating"
		}

		rowspan := meta.Rowspan
		if rowspan == 0 {
			rowspan = 1
		}
		rec := &guardsched.AssignmentRecord{
			Day:           day,
			CalendarBlock: r.ShiftIndex,
			StartHour:     r.ShiftStart.Hour(),
			Slot:          sl,
			SoldierIdx:    si,
			LocI:          meta.LocI,
			TimeJ:         meta.TimeJ,
			Weight:        meta.Weight,
			RawHours:      meta.RawHours,
			Kind:          kind,
			WindowName:    meta.Window,
			Rowspan:       rowspan,
			WinStartBlock: meta.WinStartBlock,
			WinEndBlock:   meta.WinEndBlock,
		}
		out = append(out, rec)
	}
	return out, nil
}

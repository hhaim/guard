package schedule

import (
	"encoding/json"
	"fmt"
	"math"
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
	if slot >= 0 && slot < len(labels) && labels[slot] != "" {
		return labels[slot]
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

package repo

import (
	"context"
	"encoding/json"
	"time"

	"guard/internal/db"
)

// ScheduleDutyRow is one row from the schedule table for export/reporting.
type ScheduleDutyRow struct {
	TsDate     time.Time
	DayIndex   int
	Slot       string
	ShiftIndex int
	ShiftStart string
	ShiftEnd   string
	SoldierID  string
	Meta       json.RawMessage
}

func QueryScheduleRange(ctx context.Context, pool *db.Pool, from, to time.Time) ([]ScheduleDutyRow, error) {
	rows, err := pool.Query(ctx,
		`SELECT ts_date, day_index, slot, shift_index, shift_start, shift_end, soldier_id, meta
		 FROM schedule WHERE ts_date >= $1::date AND ts_date <= $2::date
		 ORDER BY ts_date, shift_index, slot`,
		from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ScheduleDutyRow
	for rows.Next() {
		var r ScheduleDutyRow
		var ss, se time.Time
		if err := rows.Scan(&r.TsDate, &r.DayIndex, &r.Slot, &r.ShiftIndex, &ss, &se, &r.SoldierID, &r.Meta); err != nil {
			return nil, err
		}
		r.ShiftStart = ss.Format("15:04:05")
		r.ShiftEnd = se.Format("15:04:05")
		out = append(out, r)
	}
	return out, rows.Err()
}

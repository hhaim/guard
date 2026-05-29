package httpapi

import (
	"context"
	"fmt"
	"time"

	"guard/guardsched"
	"guard/internal/db"
	"guard/internal/model"
	"guard/internal/repo"
)

// historyPrefix is verified schedule replayed before a new plan segment (checkpoint-style).
type historyPrefix struct {
	Days               int
	Records            []*guardsched.AssignmentRecord
	Dates              []string
	AssignmentsReplayed int
	AssignmentsSkipped  int
}

func loadVerifiedHistoryPrefix(
	ctx context.Context,
	pool *db.Pool,
	anchor time.Time,
	historyDays int,
	soldierKeys []string,
	expectShiftHours float64,
) (*historyPrefix, error) {
	if historyDays <= 0 {
		return &historyPrefix{}, nil
	}
	from := anchor.AddDate(0, 0, -historyDays)
	to := anchor.AddDate(0, 0, -1)
	rows, err := repo.ListScheduleDays(ctx, pool, from, to)
	if err != nil {
		return nil, err
	}
	byDate := make(map[string]model.ScheduleDay, len(rows))
	for _, row := range rows {
		byDate[row.TsDate.Format("2006-01-02")] = row
	}

	out := &historyPrefix{
		Days:  historyDays,
		Dates: make([]string, historyDays),
	}
	for i := 0; i < historyDays; i++ {
		d := from.AddDate(0, 0, i)
		ds := d.Format("2006-01-02")
		out.Dates[i] = ds
		row, ok := byDate[ds]
		if !ok {
			continue
		}
		if row.Plan.ShiftHours != 0 && row.Plan.ShiftHours != expectShiftHours {
			return nil, fmt.Errorf("verified schedule on %s has shift_hours=%g, expected %g", ds, row.Plan.ShiftHours, expectShiftHours)
		}
		recs := guardsched.RecordsFromAssignmentJSON(row.Plan.Assignments, soldierKeys)
		for _, rec := range recs {
			if rec == nil {
				out.AssignmentsSkipped++
				continue
			}
			if rec.SoldierIdx < 0 || rec.SoldierIdx >= len(soldierKeys) {
				out.AssignmentsSkipped++
				continue
			}
			rec.Day = i
			out.Records = append(out.Records, rec)
			out.AssignmentsReplayed++
		}
	}
	if out.AssignmentsReplayed == 0 {
		return &historyPrefix{}, nil
	}
	return out, nil
}

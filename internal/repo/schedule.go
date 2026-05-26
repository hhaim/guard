package repo

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"guard/internal/db"
	"guard/internal/model"
)

// ListScheduleDays loads verified schedule rows in [from, to] inclusive.
func ListScheduleDays(ctx context.Context, pool *db.Pool, from, to time.Time) ([]model.ScheduleDay, error) {
	rows, err := pool.Query(ctx,
		`SELECT ts_date, plan, applied_from_slot
		 FROM schedule WHERE ts_date >= $1::date AND ts_date <= $2::date
		 ORDER BY ts_date`,
		from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.ScheduleDay
	for rows.Next() {
		var ts time.Time
		var raw []byte
		var slot *string
		if err := rows.Scan(&ts, &raw, &slot); err != nil {
			return nil, err
		}
		var plan model.PlanDoc
		if err := json.Unmarshal(raw, &plan); err != nil {
			return nil, fmt.Errorf("parse plan for %s: %w", ts.Format("2006-01-02"), err)
		}
		day := model.ScheduleDay{TsDate: ts, Plan: plan}
		if slot != nil {
			day.AppliedFromSlot = *slot
		}
		out = append(out, day)
	}
	return out, rows.Err()
}

// ExistingScheduleDates returns dates from candidates that already have a schedule row.
func ExistingScheduleDates(ctx context.Context, tx pgx.Tx, dates []time.Time) ([]string, error) {
	if len(dates) == 0 {
		return nil, nil
	}
	rows, err := tx.Query(ctx,
		`SELECT ts_date::text FROM schedule WHERE ts_date = ANY($1::date[]) ORDER BY ts_date`,
		dates)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var d string
		if err := rows.Scan(&d); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// InsertScheduleDay stores one verified calendar day.
func InsertScheduleDay(ctx context.Context, tx pgx.Tx, day model.ScheduleDay, appliedFromSlot string) error {
	raw, err := json.Marshal(day.Plan)
	if err != nil {
		return err
	}
	var slot any
	if appliedFromSlot != "" {
		slot = appliedFromSlot
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO schedule (ts_date, plan, applied_from_slot) VALUES ($1::date, $2, $3)`,
		day.TsDate, raw, slot)
	if err != nil {
		return fmt.Errorf("insert schedule day %s: %w", day.TsDate.Format("2006-01-02"), err)
	}
	return nil
}

// DeleteScheduleDay removes one verified calendar day.
func DeleteScheduleDay(ctx context.Context, pool *db.Pool, date time.Time) (bool, error) {
	tag, err := pool.Exec(ctx, `DELETE FROM schedule WHERE ts_date = $1::date`, date)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// MergeScheduleRange loads days in range and returns one combined PlanDoc.
func MergeScheduleRange(ctx context.Context, pool *db.Pool, from, to time.Time) (model.PlanDoc, error) {
	days, err := ListScheduleDays(ctx, pool, from, to)
	if err != nil {
		return model.PlanDoc{}, err
	}
	return model.MergeScheduleDays(from, days)
}

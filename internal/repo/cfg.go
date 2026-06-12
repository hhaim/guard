package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"guard/internal/db"
	"guard/internal/model"
)

// ErrVersionConflict is returned when optimistic locking fails.
var ErrVersionConflict = errors.New("cfg version conflict")

type CfgRow struct {
	Key       string
	Value     json.RawMessage
	UpdatedAt time.Time
	Version   int64
}

func GetCfg(ctx context.Context, pool *db.Pool, key string) (*CfgRow, error) {
	var row CfgRow
	err := pool.QueryRow(ctx,
		`SELECT key, value, updated_at, version FROM cfg WHERE key = $1`, key,
	).Scan(&row.Key, &row.Value, &row.UpdatedAt, &row.Version)
	if errors.Is(err, pgx.ErrNoRows) {
		return &CfgRow{Key: key, Value: json.RawMessage(`{}`), Version: 0}, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// GetCfgForUpdate loads a cfg row with FOR UPDATE inside an open transaction.
// If the key is absent, returns an empty document with version 0 (no row locked).
func GetCfgForUpdate(ctx context.Context, tx pgx.Tx, key string) (*CfgRow, error) {
	var row CfgRow
	err := tx.QueryRow(ctx,
		`SELECT key, value, updated_at, version FROM cfg WHERE key = $1 FOR UPDATE`, key,
	).Scan(&row.Key, &row.Value, &row.UpdatedAt, &row.Version)
	if errors.Is(err, pgx.ErrNoRows) {
		return &CfgRow{Key: key, Value: json.RawMessage(`{}`), Version: 0}, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// PutCfg updates cfg inside an existing transaction.
// expectedVersion must always be supplied: use 0 when the key does not exist yet (see GET /api/cfg).
// For an existing row, expectedVersion must equal the stored version or ErrVersionConflict is returned.
func PutCfg(ctx context.Context, tx pgx.Tx, key string, value json.RawMessage, expectedVersion *int64) (*CfgRow, error) {
	if expectedVersion == nil {
		return nil, fmt.Errorf("expected_version is required")
	}
	var cur int64
	err := tx.QueryRow(ctx, `SELECT version FROM cfg WHERE key = $1 FOR UPDATE`, key).Scan(&cur)
	if errors.Is(err, pgx.ErrNoRows) {
		if *expectedVersion != 0 {
			return nil, ErrVersionConflict
		}
		_, err = tx.Exec(ctx,
			`INSERT INTO cfg (key, value, updated_at, version) VALUES ($1, $2, now(), 1)`,
			key, value)
		if err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	} else {
		if *expectedVersion != cur {
			return nil, ErrVersionConflict
		}
		_, err = tx.Exec(ctx,
			`UPDATE cfg SET value = $2, updated_at = now(), version = version + 1 WHERE key = $1`,
			key, value)
		if err != nil {
			return nil, err
		}
	}
	var row CfgRow
	err = tx.QueryRow(ctx,
		`SELECT key, value, updated_at, version FROM cfg WHERE key = $1`, key,
	).Scan(&row.Key, &row.Value, &row.UpdatedAt, &row.Version)
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// UpsertCfg inserts or replaces a cfg row without optimistic locking (used for derived keys like summaries).
func UpsertCfg(ctx context.Context, tx pgx.Tx, key string, value json.RawMessage) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO cfg (key, value, updated_at, version) VALUES ($1, $2, now(), 1)
		 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), version = cfg.version + 1`,
		key, value)
	return err
}

func AppendAudit(ctx context.Context, tx pgx.Tx, key string, newCfg json.RawMessage, actor string) error {
	var actorVal any
	if actor != "" {
		actorVal = actor
	}
	_, err := tx.Exec(ctx,
		`INSERT INTO audit (key, new_cfg, actor) VALUES ($1, $2, $3)`, key, newCfg, actorVal)
	return err
}

// ScheduleReportRow is one aggregated fairness row.
type ScheduleReportRow struct {
	SoldierID string    `json:"soldier_id"`
	TsDate    time.Time `json:"ts_date"`
	Blocks    int64     `json:"blocks"`
}

// GetProposalKey returns the cfg key for a planning slot (slot must be "01".."04").
func GetProposalKey(anchor time.Time, slot string) string {
	return fmt.Sprintf("proposal-%s-%s", anchor.Format("2006-01-02"), slot)
}

// ListCfgKeys returns cfg keys with the given prefix.
func ListCfgKeys(ctx context.Context, pool *db.Pool, prefix string) ([]string, error) {
	rows, err := pool.Query(ctx, `SELECT key FROM cfg WHERE key LIKE $1 ORDER BY key`, prefix+"%")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var keys []string
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return nil, err
		}
		keys = append(keys, k)
	}
	return keys, rows.Err()
}

// DeleteCfgByPrefix removes all cfg rows whose key starts with prefix.
func DeleteCfgByPrefix(ctx context.Context, tx pgx.Tx, prefix string) error {
	_, err := tx.Exec(ctx, `DELETE FROM cfg WHERE key LIKE $1`, prefix+"%")
	return err
}

// DeleteCfgKey removes a single cfg row (no-op if missing).
func DeleteCfgKey(ctx context.Context, tx pgx.Tx, key string) error {
	_, err := tx.Exec(ctx, `DELETE FROM cfg WHERE key = $1`, key)
	return err
}

// DeleteAllSchedule removes every row from the schedule table.
func DeleteAllSchedule(ctx context.Context, pool *db.Pool) (int64, error) {
	tag, err := pool.Exec(ctx, `DELETE FROM schedule`)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func ReportBlocksBySoldierDate(ctx context.Context, pool *db.Pool, from, to time.Time) ([]ScheduleReportRow, error) {
	days, err := ListScheduleDays(ctx, pool, from, to)
	if err != nil {
		return nil, err
	}
	agg := model.BlocksBySoldierDate(days)
	out := make([]ScheduleReportRow, len(agg))
	for i, r := range agg {
		out[i] = ScheduleReportRow{SoldierID: r.SoldierID, TsDate: r.TsDate, Blocks: r.Blocks}
	}
	return out, nil
}

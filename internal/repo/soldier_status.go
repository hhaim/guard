package repo

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"guard/internal/availability"
	"guard/internal/db"
)

type StatusEntryRow struct {
	ID         int64
	SoldierID  string
	StartAt    time.Time
	EndAt      *time.Time
	Status     string
	Note       string
	Actor      string
	CreatedAt  time.Time
	CompactedAt *time.Time
	Resolved   bool
}

// ListStatusEntriesForRange returns hot ∪ resolved rows overlapping [from, to).
func ListStatusEntriesForRange(ctx context.Context, pool *db.Pool, from, to time.Time) ([]availability.Entry, error) {
	if err := EnsurePartitions(ctx, pool, 30, 7); err != nil {
		return nil, err
	}
	var out []availability.Entry

	rows, err := pool.Query(ctx, `
		SELECT soldier_id, start_at, end_at, status
		FROM soldier_status_resolved
		WHERE start_at < $2 AND (end_at IS NULL OR end_at > $1)
	`, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var e availability.Entry
		var end *time.Time
		if err := rows.Scan(&e.SoldierID, &e.StartAt, &end, &e.Status); err != nil {
			return nil, err
		}
		e.Status = availability.NormalizeStatus(e.Status)
		e.EndAt = end
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	rows2, err := pool.Query(ctx, `
		SELECT soldier_id, start_at, end_at, status
		FROM soldier_status_entry
		WHERE compacted_at IS NULL
		  AND start_at < $2 AND (end_at IS NULL OR end_at > $1)
	`, from, to)
	if err != nil {
		return nil, err
	}
	defer rows2.Close()
	for rows2.Next() {
		var e availability.Entry
		var end *time.Time
		if err := rows2.Scan(&e.SoldierID, &e.StartAt, &end, &e.Status); err != nil {
			return nil, err
		}
		e.Status = availability.NormalizeStatus(e.Status)
		e.EndAt = end
		out = append(out, e)
	}
	return out, rows2.Err()
}

type CreateStatusEntryParams struct {
	SoldierID string
	StartAt   time.Time
	EndAt     *time.Time
	Status    string
	Note      string
	Actor     string
}

func CreateStatusEntry(ctx context.Context, pool *db.Pool, p CreateStatusEntryParams) (int64, error) {
	if err := EnsurePartitions(ctx, pool, 30, 7); err != nil {
		return 0, err
	}
	p.Status = availability.NormalizeStatus(p.Status)
	if p.Status == availability.StatusBase {
		return 0, fmt.Errorf("cannot create base status row")
	}
	if p.EndAt != nil && !p.EndAt.After(p.StartAt) {
		return 0, fmt.Errorf("end_at must be after start_at")
	}
	var id int64
	err := pool.QueryRow(ctx, `
		INSERT INTO soldier_status_entry (soldier_id, start_at, end_at, status, note, actor)
		VALUES ($1, $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''))
		RETURNING id
	`, p.SoldierID, p.StartAt, p.EndAt, p.Status, p.Note, p.Actor).Scan(&id)
	return id, err
}

// CompactStatusEntries moves closed hot rows (and materialized open rows) into resolved before planning.
func CompactStatusEntries(ctx context.Context, pool *db.Pool, asOf time.Time) error {
	asOf = asOf.UTC()
	dayEnd := time.Date(asOf.Year(), asOf.Month(), asOf.Day(), 23, 59, 59, int(time.Second-time.Nanosecond), time.UTC)

	rows, err := pool.Query(ctx, `
		SELECT id, soldier_id, start_at, end_at, status, note, actor, created_at
		FROM soldier_status_entry
		WHERE compacted_at IS NULL
		  AND (end_at IS NULL OR end_at <= $1)
	`, dayEnd)
	if err != nil {
		return err
	}
	defer rows.Close()

	type hotRow struct {
		id        int64
		soldierID string
		startAt   time.Time
		endAt     *time.Time
		status    string
		note      string
		actor     string
		createdAt time.Time
	}
	var batch []hotRow
	for rows.Next() {
		var h hotRow
		if err := rows.Scan(&h.id, &h.soldierID, &h.startAt, &h.endAt, &h.status, &h.note, &h.actor, &h.createdAt); err != nil {
			return err
		}
		batch = append(batch, h)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	for _, h := range batch {
		h.status = availability.NormalizeStatus(h.status)
		if h.endAt != nil {
			_, err = tx.Exec(ctx, `
				INSERT INTO soldier_status_resolved (soldier_id, start_at, end_at, status, note, actor, is_open)
				VALUES ($1, $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''), false)
			`, h.soldierID, h.startAt, h.endAt, h.status, h.note, h.actor)
			if err != nil {
				return err
			}
		} else {
			_, err = tx.Exec(ctx, `
				INSERT INTO soldier_status_resolved (soldier_id, start_at, end_at, status, note, actor, is_open)
				VALUES ($1, $2, NULL, $3, NULLIF($4, ''), NULLIF($5, ''), true)
				ON CONFLICT (soldier_id) WHERE is_open = true
				DO UPDATE SET
					start_at = LEAST(soldier_status_resolved.start_at, EXCLUDED.start_at),
					status = EXCLUDED.status,
					note = COALESCE(NULLIF(EXCLUDED.note, ''), soldier_status_resolved.note),
					actor = COALESCE(NULLIF(EXCLUDED.actor, ''), soldier_status_resolved.actor)
			`, h.soldierID, h.startAt, h.status, h.note, h.actor)
			if err != nil {
				return err
			}
		}
		_, err = tx.Exec(ctx, `
			UPDATE soldier_status_entry SET compacted_at = now() WHERE start_at = $2 AND id = $1
		`, h.id, h.startAt)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `
			DELETE FROM soldier_status_entry WHERE start_at = $2 AND id = $1 AND end_at IS NOT NULL
		`, h.id, h.startAt)
		if err != nil {
			return err
		}
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO soldier_state_snapshot (as_of, compacted_through, payload)
		VALUES ($1::date, now(), '{}'::jsonb)
		ON CONFLICT (as_of) DO UPDATE SET compacted_through = now()
	`, asOf.Format("2006-01-02"))
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func EnsurePartitions(ctx context.Context, pool *db.Pool, retention, future int) error {
	_, err := pool.Exec(ctx, `SELECT guard_ensure_partitions($1, $2)`, retention, future)
	return err
}

// ListHotStatusEntries lists recent uncompacted hot rows for admin UI.
func ListHotStatusEntries(ctx context.Context, pool *db.Pool, from, to time.Time) ([]StatusEntryRow, error) {
	if err := EnsurePartitions(ctx, pool, 30, 7); err != nil {
		return nil, err
	}
	rows, err := pool.Query(ctx, `
		SELECT id, soldier_id, start_at, end_at, status, COALESCE(note, ''), COALESCE(actor, ''),
		       created_at, compacted_at
		FROM soldier_status_entry
		WHERE start_at < $2 AND (end_at IS NULL OR end_at > $1)
		ORDER BY start_at, id
	`, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []StatusEntryRow
	for rows.Next() {
		var r StatusEntryRow
		if err := rows.Scan(&r.ID, &r.SoldierID, &r.StartAt, &r.EndAt, &r.Status, &r.Note, &r.Actor,
			&r.CreatedAt, &r.CompactedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// PatchStatusEntry updates end_at/note on a hot row.
func PatchStatusEntry(ctx context.Context, pool *db.Pool, id int64, startAt time.Time, endAt *time.Time, note string) error {
	ct, err := pool.Exec(ctx, `
		UPDATE soldier_status_entry
		SET end_at = COALESCE($3, end_at),
		    note = CASE WHEN $4 = '' THEN note ELSE $4 END
		WHERE id = $1 AND start_at = $2 AND compacted_at IS NULL
	`, id, startAt, endAt, note)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func DeleteHotStatusEntry(ctx context.Context, pool *db.Pool, id int64, startAt time.Time) error {
	ct, err := pool.Exec(ctx, `
		DELETE FROM soldier_status_entry
		WHERE id = $1 AND start_at = $2 AND compacted_at IS NULL
	`, id, startAt)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

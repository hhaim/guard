package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"

	"guard/internal/availability"
	"guard/internal/db"
)

// HotStatusEditMaxAge is the window in which hot status rows may be edited or deleted.
const HotStatusEditMaxAge = 7 * 24 * time.Hour

var (
	ErrStatusOverlaps = errors.New("status interval overlaps an existing entry for this soldier")
	ErrStatusTooOld     = errors.New("status entry is older than 7 days and cannot be edited")
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
	if err := closeOpenStatusBefore(ctx, pool, p.SoldierID, p.StartAt); err != nil {
		return 0, err
	}
	if err := assertNoOverlappingStatus(ctx, pool, p.SoldierID, p.StartAt, p.EndAt, 0); err != nil {
		return 0, err
	}
	var id int64
	err := pool.QueryRow(ctx, `
		INSERT INTO soldier_status_entry (soldier_id, start_at, end_at, status, note, actor)
		VALUES ($1, $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''))
		RETURNING id
	`, p.SoldierID, p.StartAt, p.EndAt, p.Status, p.Note, p.Actor).Scan(&id)
	return id, err
}

func closeOpenStatusBefore(ctx context.Context, pool *db.Pool, soldierID string, newStart time.Time) error {
	newStart = newStart.UTC()
	_, err := pool.Exec(ctx, `
		UPDATE soldier_status_entry
		SET end_at = $2
		WHERE soldier_id = $1
		  AND compacted_at IS NULL
		  AND end_at IS NULL
		  AND start_at < $2
	`, soldierID, newStart)
	if err != nil {
		return err
	}
	_, err = pool.Exec(ctx, `
		UPDATE soldier_status_resolved
		SET end_at = $2, is_open = false
		WHERE soldier_id = $1
		  AND is_open = true
		  AND start_at < $2
	`, soldierID, newStart)
	return err
}

func assertNoOverlappingStatus(
	ctx context.Context,
	pool *db.Pool,
	soldierID string,
	startAt time.Time,
	endAt *time.Time,
	excludeID int64,
) error {
	startAt = startAt.UTC()
	rows, err := pool.Query(ctx, `
		SELECT start_at, end_at
		FROM soldier_status_entry
		WHERE soldier_id = $1
		  AND compacted_at IS NULL
		  AND ($2::bigint = 0 OR id <> $2)
		UNION ALL
		SELECT start_at, end_at
		FROM soldier_status_resolved
		WHERE soldier_id = $1
	`, soldierID, excludeID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var existingStart time.Time
		var existingEnd *time.Time
		if err := rows.Scan(&existingStart, &existingEnd); err != nil {
			return err
		}
		if availability.EntriesOverlap(startAt, endAt, existingStart, existingEnd) {
			return ErrStatusOverlaps
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return nil
}

// GetHotStatusEntry loads an uncompacted hot row for edit/delete policy checks.
func GetHotStatusEntry(ctx context.Context, pool *db.Pool, id int64, startAt time.Time) (StatusEntryRow, error) {
	var r StatusEntryRow
	err := pool.QueryRow(ctx, `
		SELECT id, soldier_id, start_at, end_at, status, COALESCE(note, ''), COALESCE(actor, ''),
		       created_at, compacted_at
		FROM soldier_status_entry
		WHERE id = $1 AND start_at = $2 AND compacted_at IS NULL
	`, id, startAt.UTC()).Scan(
		&r.ID, &r.SoldierID, &r.StartAt, &r.EndAt, &r.Status, &r.Note, &r.Actor,
		&r.CreatedAt, &r.CompactedAt,
	)
	if err != nil {
		return r, err
	}
	return r, nil
}

func assertHotEntryEditable(row StatusEntryRow) error {
	if row.CompactedAt != nil {
		return pgx.ErrNoRows
	}
	if time.Since(row.CreatedAt.UTC()) > HotStatusEditMaxAge {
		return ErrStatusTooOld
	}
	return nil
}

// HotStatusEntryEditable reports whether a hot row may be patched or deleted in the UI/API.
func HotStatusEntryEditable(row StatusEntryRow) bool {
	return assertHotEntryEditable(row) == nil
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

// PatchStatusEntry updates end_at/note on a hot row within the edit window.
func PatchStatusEntry(ctx context.Context, pool *db.Pool, id int64, startAt time.Time, endAt *time.Time, note string) error {
	row, err := GetHotStatusEntry(ctx, pool, id, startAt)
	if err != nil {
		return err
	}
	if err := assertHotEntryEditable(row); err != nil {
		return err
	}
	newEnd := row.EndAt
	if endAt != nil {
		newEnd = endAt
	}
	if newEnd != nil && !newEnd.After(row.StartAt) {
		return fmt.Errorf("end_at must be after start_at")
	}
	if err := assertNoOverlappingStatus(ctx, pool, row.SoldierID, row.StartAt, newEnd, id); err != nil {
		return err
	}
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

// DeleteHotStatusEntry removes a hot row and records an audit entry.
func DeleteHotStatusEntry(ctx context.Context, pool *db.Pool, id int64, startAt time.Time, actor string) error {
	row, err := GetHotStatusEntry(ctx, pool, id, startAt)
	if err != nil {
		return err
	}
	if err := assertHotEntryEditable(row); err != nil {
		return err
	}
	payload, err := json.Marshal(map[string]any{
		"action": "delete",
		"entry": map[string]any{
			"id":         row.ID,
			"soldier_id": row.SoldierID,
			"start_at":   row.StartAt.UTC().Format(time.RFC3339),
			"end_at":     formatEndAt(row.EndAt),
			"status":     row.Status,
			"note":       row.Note,
			"actor":      row.Actor,
			"created_at": row.CreatedAt.UTC().Format(time.RFC3339),
		},
	})
	if err != nil {
		return err
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		INSERT INTO audit (key, new_cfg, actor)
		VALUES ('soldier_status_entry', $1::jsonb, NULLIF($2, ''))
	`, payload, actor); err != nil {
		return err
	}
	ct, err := tx.Exec(ctx, `
		DELETE FROM soldier_status_entry
		WHERE id = $1 AND start_at = $2 AND compacted_at IS NULL
	`, id, startAt)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return tx.Commit(ctx)
}

func formatEndAt(end *time.Time) any {
	if end == nil {
		return nil
	}
	return end.UTC().Format(time.RFC3339)
}

type intervalPiece struct {
	start time.Time
	end   *time.Time
}

// piecesOutsideWindow returns sub-intervals of [s,e) that do not overlap [winStart, winEnd).
func piecesOutsideWindow(s time.Time, e *time.Time, winStart, winEnd time.Time) []intervalPiece {
	s = s.UTC()
	winStart = winStart.UTC()
	winEnd = winEnd.UTC()
	entEnd := availability.EntryRangeEnd(e)
	if !availability.Overlaps(s, entEnd, winStart, winEnd) {
		return []intervalPiece{{start: s, end: e}}
	}
	var out []intervalPiece
	if s.Before(winStart) {
		end := winStart
		out = append(out, intervalPiece{start: s, end: &end})
	}
	if entEnd.After(winEnd) {
		start := winEnd
		var end *time.Time
		if e != nil {
			end = e
		}
		out = append(out, intervalPiece{start: start, end: end})
	}
	return out
}

// ImportSoldierStatus replaces hot and resolved status rows overlapping [from, to) for the
// given soldiers, then inserts entries as new hot rows (YAML roster restore).
func ImportSoldierStatus(
	ctx context.Context,
	pool *db.Pool,
	from, to time.Time,
	soldierIDs []string,
	entries []CreateStatusEntryParams,
) error {
	if err := EnsurePartitions(ctx, pool, 30, 400); err != nil {
		return err
	}
	from = from.UTC()
	to = to.UTC()
	if !to.After(from) {
		return fmt.Errorf("invalid import range")
	}
	if len(soldierIDs) == 0 {
		return fmt.Errorf("soldier_ids required")
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		DELETE FROM soldier_status_resolved
		WHERE soldier_id = ANY($1)
		  AND start_at < $3 AND (end_at IS NULL OR end_at > $2)
	`, soldierIDs, from, to); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		DELETE FROM soldier_status_entry
		WHERE soldier_id = ANY($1)
		  AND compacted_at IS NULL
		  AND start_at < $3 AND (end_at IS NULL OR end_at > $2)
	`, soldierIDs, from, to); err != nil {
		return err
	}

	sort.Slice(entries, func(i, j int) bool {
		if entries[i].SoldierID != entries[j].SoldierID {
			return entries[i].SoldierID < entries[j].SoldierID
		}
		return entries[i].StartAt.Before(entries[j].StartAt)
	})

	for _, p := range entries {
		p.Status = availability.NormalizeStatus(p.Status)
		if !availability.IsBlockingStatus(p.Status) {
			continue
		}
		if p.EndAt != nil && !p.EndAt.After(p.StartAt) {
			return fmt.Errorf("end_at must be after start_at for soldier %s", p.SoldierID)
		}
		if err := closeOpenStatusBeforeTx(ctx, tx, p.SoldierID, p.StartAt); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO soldier_status_entry (soldier_id, start_at, end_at, status, note, actor)
			VALUES ($1, $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''))
		`, p.SoldierID, p.StartAt.UTC(), p.EndAt, p.Status, p.Note, p.Actor); err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

func closeOpenStatusBeforeTx(ctx context.Context, tx pgx.Tx, soldierID string, newStart time.Time) error {
	newStart = newStart.UTC()
	if _, err := tx.Exec(ctx, `
		UPDATE soldier_status_entry
		SET end_at = $2
		WHERE soldier_id = $1
		  AND compacted_at IS NULL
		  AND end_at IS NULL
		  AND start_at < $2
	`, soldierID, newStart); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `
		UPDATE soldier_status_resolved
		SET end_at = $2, is_open = false
		WHERE soldier_id = $1
		  AND is_open = true
		  AND start_at < $2
	`, soldierID, newStart)
	return err
}

// ClearStatusForWindow removes blocking status during [winStart, winEnd) by trimming or deleting entries.
func ClearStatusForWindow(ctx context.Context, pool *db.Pool, soldierID string, winStart, winEnd time.Time) error {
	if err := EnsurePartitions(ctx, pool, 30, 7); err != nil {
		return err
	}
	winStart = winStart.UTC()
	winEnd = winEnd.UTC()
	if !winEnd.After(winStart) {
		return fmt.Errorf("invalid clear window")
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	type row struct {
		id        int64
		startAt   time.Time
		endAt     *time.Time
		status    string
		note      string
		actor     string
		createdAt time.Time
		resolved  bool
	}
	var rows []row

	hotRows, err := tx.Query(ctx, `
		SELECT id, start_at, end_at, status, COALESCE(note, ''), COALESCE(actor, ''), created_at
		FROM soldier_status_entry
		WHERE soldier_id = $1
		  AND compacted_at IS NULL
		  AND start_at < $3 AND (end_at IS NULL OR end_at > $2)
	`, soldierID, winStart, winEnd)
	if err != nil {
		return err
	}
	for hotRows.Next() {
		var h row
		if err := hotRows.Scan(&h.id, &h.startAt, &h.endAt, &h.status, &h.note, &h.actor, &h.createdAt); err != nil {
			hotRows.Close()
			return err
		}
		h.resolved = false
		rows = append(rows, h)
	}
	hotRows.Close()
	if err := hotRows.Err(); err != nil {
		return err
	}

	resRows, err := tx.Query(ctx, `
		SELECT id, start_at, end_at, status, COALESCE(note, ''), COALESCE(actor, ''), created_at
		FROM soldier_status_resolved
		WHERE soldier_id = $1
		  AND start_at < $3 AND (end_at IS NULL OR end_at > $2)
	`, soldierID, winStart, winEnd)
	if err != nil {
		return err
	}
	for resRows.Next() {
		var r row
		if err := resRows.Scan(&r.id, &r.startAt, &r.endAt, &r.status, &r.note, &r.actor, &r.createdAt); err != nil {
			resRows.Close()
			return err
		}
		r.resolved = true
		rows = append(rows, r)
	}
	resRows.Close()
	if err := resRows.Err(); err != nil {
		return err
	}

	for _, h := range rows {
		pieces := piecesOutsideWindow(h.startAt, h.endAt, winStart, winEnd)
		if h.resolved {
			if _, err := tx.Exec(ctx, `DELETE FROM soldier_status_resolved WHERE id = $1`, h.id); err != nil {
				return err
			}
		} else {
			if _, err := tx.Exec(ctx, `
				DELETE FROM soldier_status_entry WHERE id = $1 AND start_at = $2
			`, h.id, h.startAt); err != nil {
				return err
			}
		}
		for _, p := range pieces {
			st := availability.NormalizeStatus(h.status)
			if p.end != nil && !p.end.After(p.start) {
				continue
			}
			if h.resolved {
				isOpen := p.end == nil
				_, err = tx.Exec(ctx, `
					INSERT INTO soldier_status_resolved (soldier_id, start_at, end_at, status, note, actor, is_open)
					VALUES ($1, $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''), $7)
				`, soldierID, p.start, p.end, st, h.note, h.actor, isOpen)
			} else {
				_, err = tx.Exec(ctx, `
					INSERT INTO soldier_status_entry (soldier_id, start_at, end_at, status, note, actor)
					VALUES ($1, $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''))
				`, soldierID, p.start, p.end, st, h.note, h.actor)
			}
			if err != nil {
				return err
			}
		}
	}

	return tx.Commit(ctx)
}

package db

import (
	"context"
	"fmt"
	"sort"

	"github.com/jackc/pgx/v5/pgxpool"
)

const ensureMigrationsTableSQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`

// baselineMigrationsSQL marks all embedded migrations applied when the DB already
// has the per-day schedule schema but no migration history (upgrade from pre-tracking).
const baselineMigrationsSQL = `
INSERT INTO schema_migrations (name)
SELECT v.name
FROM (VALUES
    ('000001_init.sql'),
    ('000002_users.sql'),
    ('000003_schedule_per_day_json.sql')
) AS v(name)
WHERE EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'schedule'
      AND column_name = 'plan'
)
AND NOT EXISTS (SELECT 1 FROM schema_migrations LIMIT 1)
ON CONFLICT (name) DO NOTHING;
`

// Migrate runs embedded SQL files once each, in lexical order.
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	if _, err := pool.Exec(ctx, ensureMigrationsTableSQL); err != nil {
		return fmt.Errorf("ensure schema_migrations: %w", err)
	}
	if _, err := pool.Exec(ctx, baselineMigrationsSQL); err != nil {
		return fmt.Errorf("baseline schema_migrations: %w", err)
	}

	entries, err := migrationsFS.ReadDir("migrations")
	if err != nil {
		return fmt.Errorf("read migrations dir: %w", err)
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)

	for _, name := range names {
		var applied bool
		err := pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE name = $1)`, name,
		).Scan(&applied)
		if err != nil {
			return fmt.Errorf("check migration %s: %w", name, err)
		}
		if applied {
			continue
		}

		b, err := migrationsFS.ReadFile("migrations/" + name)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", name, err)
		}
		if _, err := pool.Exec(ctx, string(b)); err != nil {
			return fmt.Errorf("exec migration %s: %w", name, err)
		}
		if _, err := pool.Exec(ctx,
			`INSERT INTO schema_migrations (name) VALUES ($1)`, name,
		); err != nil {
			return fmt.Errorf("record migration %s: %w", name, err)
		}
	}

	if err := maintainRetention(ctx, pool); err != nil {
		return err
	}
	return nil
}

// maintainRetention ensures 40-day partition blocks exist and drops blocks past 30-day retention.
func maintainRetention(ctx context.Context, pool *pgxpool.Pool) error {
	var hasFn bool
	err := pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM pg_proc p
			JOIN pg_namespace n ON n.oid = p.pronamespace
			WHERE n.nspname = 'public' AND p.proname = 'guard_retention_maintain'
		)`).Scan(&hasFn)
	if err != nil {
		return fmt.Errorf("check guard_retention_maintain: %w", err)
	}
	if !hasFn {
		return nil
	}
	var dropped int
	if err := pool.QueryRow(ctx, `SELECT guard_retention_maintain(30, 7)`).Scan(&dropped); err != nil {
		return fmt.Errorf("guard_retention_maintain: %w", err)
	}
	return nil
}

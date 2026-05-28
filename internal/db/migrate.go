package db

import (
	"context"
	"errors"
	"fmt"
	"sort"

	"github.com/jackc/pgx/v5/pgxpool"
)

const squashedMigrationName = "000001_schema.sql"

// ErrSchemaResetRequired means app tables exist but the squashed migration was never applied.
// Wipe the database manually (e.g. docker compose down -v) — migrations do not auto-drop data.
var ErrSchemaResetRequired = errors.New("database schema reset required")

const ensureMigrationsTableSQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`

// Migrate runs embedded SQL files once each, in lexical order.
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	if _, err := pool.Exec(ctx, ensureMigrationsTableSQL); err != nil {
		return fmt.Errorf("ensure schema_migrations: %w", err)
	}

	if err := validateSchemaState(ctx, pool); err != nil {
		return err
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

// validateSchemaState refuses to start when old tables exist without the squashed migration recorded.
// Empty DB with stale schema_migrations rows only: clear history so 000001_schema.sql can run once.
func validateSchemaState(ctx context.Context, pool *pgxpool.Pool) error {
	squashedApplied, err := squashedMigrationApplied(ctx, pool)
	if err != nil {
		return err
	}
	if squashedApplied {
		return nil
	}

	present, err := appSchemaPresent(ctx, pool)
	if err != nil {
		return err
	}
	if present {
		return fmt.Errorf(
			"%w: found existing app tables but %q is not in schema_migrations; "+
				"reset the database once (local: docker compose down -v && docker compose up --build)",
			ErrSchemaResetRequired,
			squashedMigrationName,
		)
	}

	// No app tables: drop obsolete migration history from the old incremental chain.
	if _, err := pool.Exec(ctx, `DELETE FROM schema_migrations`); err != nil {
		return fmt.Errorf("clear stale schema_migrations: %w", err)
	}
	return nil
}

func squashedMigrationApplied(ctx context.Context, pool *pgxpool.Pool) (bool, error) {
	var applied bool
	err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE name = $1)`,
		squashedMigrationName,
	).Scan(&applied)
	if err != nil {
		return false, fmt.Errorf("check squashed migration: %w", err)
	}
	return applied, nil
}

func appSchemaPresent(ctx context.Context, pool *pgxpool.Pool) (bool, error) {
	for _, table := range []string{"cfg", "app_users", "schedule", "audit"} {
		var exists bool
		err := pool.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1
				FROM information_schema.tables
				WHERE table_schema = 'public' AND table_name = $1
			)`, table).Scan(&exists)
		if err != nil {
			return false, fmt.Errorf("check table %s: %w", table, err)
		}
		if exists {
			return true, nil
		}
	}
	return false, nil
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

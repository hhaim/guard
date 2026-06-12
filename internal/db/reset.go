package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// resetAppSchemaSQL drops all guard application tables and partition helpers.
const resetAppSchemaSQL = `
DROP TABLE IF EXISTS soldier_status_entry CASCADE;
DROP TABLE IF EXISTS soldier_status_resolved CASCADE;
DROP TABLE IF EXISTS soldier_state_snapshot CASCADE;
DROP TABLE IF EXISTS user_invites CASCADE;
DROP TABLE IF EXISTS app_users CASCADE;
DROP TABLE IF EXISTS schedule_retention_staging CASCADE;
DROP TABLE IF EXISTS audit_retention_staging CASCADE;
DROP TABLE IF EXISTS schedule_unpartitioned CASCADE;
DROP TABLE IF EXISTS audit_unpartitioned CASCADE;
DROP TABLE IF EXISTS schedule CASCADE;
DROP TABLE IF EXISTS audit CASCADE;
DROP TABLE IF EXISTS cfg CASCADE;

DROP FUNCTION IF EXISTS guard_retention_maintain(integer, integer);
DROP FUNCTION IF EXISTS guard_drop_old_partitions(integer);
DROP FUNCTION IF EXISTS guard_ensure_partitions(integer, integer);
DROP FUNCTION IF EXISTS guard_ensure_soldier_status_block(date);
DROP FUNCTION IF EXISTS guard_ensure_schedule_block(date);
DROP FUNCTION IF EXISTS guard_ensure_audit_block(date);
DROP FUNCTION IF EXISTS guard_ensure_schedule_partition(date);
DROP FUNCTION IF EXISTS guard_ensure_audit_partition(date);
DROP FUNCTION IF EXISTS guard_partition_block_end(date);
DROP FUNCTION IF EXISTS guard_partition_block_start(date);
DROP FUNCTION IF EXISTS guard_partition_days();
DROP FUNCTION IF EXISTS guard_partition_anchor();
`

// ResetAppSchema removes all guard app tables/functions and optionally clears schema_migrations.
// Does not run migrations afterward; restart the API or run guardcli after a reset.
func ResetAppSchema(ctx context.Context, pool *pgxpool.Pool, clearMigrationHistory bool) error {
	if _, err := pool.Exec(ctx, resetAppSchemaSQL); err != nil {
		return fmt.Errorf("drop app schema: %w", err)
	}
	if clearMigrationHistory {
		if _, err := pool.Exec(ctx, `DELETE FROM schema_migrations`); err != nil {
			return fmt.Errorf("clear schema_migrations: %w", err)
		}
	}
	return nil
}

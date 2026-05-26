package repo

import (
	"context"
	"fmt"
	"time"

	"guard/internal/db"
)

// RunRetentionMaintenance compacts hot status rows then drops aged partitions.
func RunRetentionMaintenance(ctx context.Context, pool *db.Pool, retentionDays, futureDays int) (dropped int, err error) {
	if err := CompactStatusEntries(ctx, pool, time.Now().UTC()); err != nil {
		return 0, fmt.Errorf("compact status entries: %w", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT guard_retention_maintain($1, $2)`, retentionDays, futureDays,
	).Scan(&dropped); err != nil {
		return 0, fmt.Errorf("guard_retention_maintain: %w", err)
	}
	return dropped, nil
}

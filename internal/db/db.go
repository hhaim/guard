package db

import (
	"context"
	"embed"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// Pool wraps a pgx pool.
type Pool struct {
	*pgxpool.Pool
}

// OpenPool connects without running migrations (for guardcli db reset).
func OpenPool(ctx context.Context, databaseURL string) (*Pool, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	cfg.MaxConns = 8
	cfg.MinConns = 0
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("connect pool: %w", err)
	}
	return &Pool{Pool: pool}, nil
}

// Connect opens a pool and applies embedded migrations (each file runs once; tracked in schema_migrations).
func Connect(ctx context.Context, databaseURL string) (*Pool, error) {
	pool, err := OpenPool(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	if err := Migrate(ctx, pool.Pool); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}


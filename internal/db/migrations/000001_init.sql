-- cfg: logical configuration keys (e.g. soldiers, slots, global, time_zones, derived summaries)
CREATE TABLE IF NOT EXISTS cfg (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 1
);

-- audit: append-only configuration history
CREATE TABLE IF NOT EXISTS audit (
    id BIGSERIAL PRIMARY KEY,
    ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    key TEXT NOT NULL,
    new_cfg JSONB NOT NULL,
    request_id UUID NULL,
    actor TEXT NULL
);

CREATE INDEX IF NOT EXISTS audit_ts_idx ON audit (ts DESC);
CREATE INDEX IF NOT EXISTS audit_key_idx ON audit (key);

-- schedule: created in 000003_schedule_per_day_json.sql (per-day JSON plan)

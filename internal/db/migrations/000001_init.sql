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

-- schedule: normalized duty rows for reporting
CREATE TABLE IF NOT EXISTS schedule (
    id BIGSERIAL PRIMARY KEY,
    ts_date DATE NOT NULL,
    day_index INT NOT NULL,
    slot TEXT NOT NULL,
    shift_index INT NOT NULL,
    shift_start TIME NOT NULL,
    shift_end TIME NOT NULL,
    soldier_id TEXT NOT NULL,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS schedule_ts_date_idx ON schedule (ts_date);
CREATE INDEX IF NOT EXISTS schedule_soldier_date_idx ON schedule (soldier_id, ts_date);
CREATE INDEX IF NOT EXISTS schedule_slot_date_idx ON schedule (slot, ts_date);

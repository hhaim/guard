DROP TABLE IF EXISTS schedule;

CREATE TABLE schedule (
    ts_date DATE PRIMARY KEY,
    plan JSONB NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_from_slot TEXT NULL
);

CREATE INDEX IF NOT EXISTS schedule_applied_at_idx ON schedule (applied_at DESC);

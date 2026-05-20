CREATE TABLE IF NOT EXISTS app_users (
    clerk_user_id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('admin', 'readonly')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    invited_by TEXT NULL REFERENCES app_users (clerk_user_id)
);

CREATE TABLE IF NOT EXISTS user_invites (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('admin', 'readonly')),
    invited_by TEXT NOT NULL REFERENCES app_users (clerk_user_id),
    clerk_invitation_id TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS user_invites_pending_email_idx ON user_invites (lower(email))
WHERE accepted_at IS NULL;

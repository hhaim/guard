package repo

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"guard/internal/db"
)

var (
	ErrUserNotFound      = errors.New("user not found")
	ErrInviteNotFound    = errors.New("invite not found")
	ErrInviteNotPending  = errors.New("invite not pending")
	ErrInvalidRole       = errors.New("invalid role")
	ErrDuplicateEmail    = errors.New("duplicate email")
)

type AppUser struct {
	ClerkUserID string
	Email       string
	Role        string
	CreatedAt   time.Time
	InvitedBy   *string
}

type UserInvite struct {
	ID                int64
	Email             string
	Role              string
	InvitedBy         string
	ClerkInvitationID *string
	CreatedAt         time.Time
	AcceptedAt        *time.Time
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func GetUserByClerkID(ctx context.Context, pool *db.Pool, clerkUserID string) (*AppUser, error) {
	var u AppUser
	var invitedBy *string
	err := pool.QueryRow(ctx,
		`SELECT clerk_user_id, email, role, created_at, invited_by FROM app_users WHERE clerk_user_id = $1`,
		clerkUserID,
	).Scan(&u.ClerkUserID, &u.Email, &u.Role, &u.CreatedAt, &invitedBy)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUserNotFound
	}
	if err != nil {
		return nil, err
	}
	u.InvitedBy = invitedBy
	return &u, nil
}

func ListAppUsers(ctx context.Context, pool *db.Pool) ([]AppUser, error) {
	rows, err := pool.Query(ctx,
		`SELECT clerk_user_id, email, role, created_at, invited_by FROM app_users ORDER BY created_at`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AppUser
	for rows.Next() {
		var u AppUser
		var invitedBy *string
		if err := rows.Scan(&u.ClerkUserID, &u.Email, &u.Role, &u.CreatedAt, &invitedBy); err != nil {
			return nil, err
		}
		u.InvitedBy = invitedBy
		out = append(out, u)
	}
	return out, rows.Err()
}

func CountAdmins(ctx context.Context, pool *db.Pool) (int64, error) {
	var n int64
	err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM app_users WHERE role = 'admin'`).Scan(&n)
	return n, err
}

func CreateAppUser(ctx context.Context, pool *db.Pool, clerkUserID, email, role string, invitedBy *string) (*AppUser, error) {
	email = normalizeEmail(email)
	if role != "admin" && role != "readonly" {
		return nil, ErrInvalidRole
	}
	var u AppUser
	var invBy *string
	err := pool.QueryRow(ctx,
		`INSERT INTO app_users (clerk_user_id, email, role, invited_by)
		 VALUES ($1, $2, $3, $4)
		 RETURNING clerk_user_id, email, role, created_at, invited_by`,
		clerkUserID, email, role, invitedBy,
	).Scan(&u.ClerkUserID, &u.Email, &u.Role, &u.CreatedAt, &invBy)
	if err != nil {
		if strings.Contains(err.Error(), "unique") {
			return nil, ErrDuplicateEmail
		}
		return nil, err
	}
	u.InvitedBy = invBy
	return &u, nil
}

func GetPendingInviteByEmail(ctx context.Context, pool *db.Pool, email string) (*UserInvite, error) {
	email = normalizeEmail(email)
	var inv UserInvite
	var clerkInvID *string
	var acceptedAt *time.Time
	err := pool.QueryRow(ctx,
		`SELECT id, email, role, invited_by, clerk_invitation_id, created_at, accepted_at
		 FROM user_invites WHERE lower(email) = $1 AND accepted_at IS NULL`,
		email,
	).Scan(&inv.ID, &inv.Email, &inv.Role, &inv.InvitedBy, &clerkInvID, &inv.CreatedAt, &acceptedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrInviteNotFound
	}
	if err != nil {
		return nil, err
	}
	inv.ClerkInvitationID = clerkInvID
	inv.AcceptedAt = acceptedAt
	return &inv, nil
}

// UpsertFromInvite creates the user and marks the invite accepted in one transaction.
func UpsertFromInvite(ctx context.Context, pool *db.Pool, clerkUserID, email string, inv *UserInvite) (*AppUser, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	email = normalizeEmail(email)
	var u AppUser
	var invitedBy *string
	err = tx.QueryRow(ctx,
		`INSERT INTO app_users (clerk_user_id, email, role, invited_by)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (email) DO UPDATE SET
		   clerk_user_id = EXCLUDED.clerk_user_id,
		   role = EXCLUDED.role
		 RETURNING clerk_user_id, email, role, created_at, invited_by`,
		clerkUserID, email, inv.Role, inv.InvitedBy,
	).Scan(&u.ClerkUserID, &u.Email, &u.Role, &u.CreatedAt, &invitedBy)
	if err != nil {
		return nil, err
	}
	u.InvitedBy = invitedBy

	tag, err := tx.Exec(ctx,
		`UPDATE user_invites SET accepted_at = now() WHERE id = $1 AND accepted_at IS NULL`,
		inv.ID,
	)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrInviteNotPending
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &u, nil
}

func ListInvites(ctx context.Context, pool *db.Pool) ([]UserInvite, error) {
	rows, err := pool.Query(ctx,
		`SELECT id, email, role, invited_by, clerk_invitation_id, created_at, accepted_at
		 FROM user_invites ORDER BY created_at DESC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []UserInvite
	for rows.Next() {
		var inv UserInvite
		var clerkInvID *string
		var acceptedAt *time.Time
		if err := rows.Scan(&inv.ID, &inv.Email, &inv.Role, &inv.InvitedBy, &clerkInvID, &inv.CreatedAt, &acceptedAt); err != nil {
			return nil, err
		}
		inv.ClerkInvitationID = clerkInvID
		inv.AcceptedAt = acceptedAt
		out = append(out, inv)
	}
	return out, rows.Err()
}

func CreateInvite(ctx context.Context, pool *db.Pool, email, role, invitedBy string, clerkInvitationID *string) (*UserInvite, error) {
	email = normalizeEmail(email)
	if role != "admin" && role != "readonly" {
		return nil, ErrInvalidRole
	}
	var inv UserInvite
	var clerkInvID *string
	var acceptedAt *time.Time
	err := pool.QueryRow(ctx,
		`INSERT INTO user_invites (email, role, invited_by, clerk_invitation_id)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, email, role, invited_by, clerk_invitation_id, created_at, accepted_at`,
		email, role, invitedBy, clerkInvitationID,
	).Scan(&inv.ID, &inv.Email, &inv.Role, &inv.InvitedBy, &clerkInvID, &inv.CreatedAt, &acceptedAt)
	if err != nil {
		if strings.Contains(err.Error(), "unique") {
			return nil, ErrDuplicateEmail
		}
		return nil, err
	}
	inv.ClerkInvitationID = clerkInvID
	inv.AcceptedAt = acceptedAt
	return &inv, nil
}

// DeleteInvitesByEmail removes all invites for the email (repair / replace).
func DeleteInvitesByEmail(ctx context.Context, pool *db.Pool, email string) (int64, error) {
	email = normalizeEmail(email)
	tag, err := pool.Exec(ctx, `DELETE FROM user_invites WHERE lower(email) = $1`, email)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// FirstAdminClerkID returns the clerk_user_id of any admin, or ErrUserNotFound.
func FirstAdminClerkID(ctx context.Context, pool *db.Pool) (string, error) {
	var id string
	err := pool.QueryRow(ctx,
		`SELECT clerk_user_id FROM app_users WHERE role = 'admin' ORDER BY created_at LIMIT 1`,
	).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrUserNotFound
	}
	return id, err
}

func DeletePendingInvite(ctx context.Context, pool *db.Pool, id int64) error {
	tag, err := pool.Exec(ctx,
		`DELETE FROM user_invites WHERE id = $1 AND accepted_at IS NULL`, id,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrInviteNotFound
	}
	return nil
}

func SetInviteClerkID(ctx context.Context, pool *db.Pool, id int64, clerkInvitationID string) error {
	_, err := pool.Exec(ctx,
		`UPDATE user_invites SET clerk_invitation_id = $2 WHERE id = $1`, id, clerkInvitationID,
	)
	return err
}

func ValidateRole(role string) error {
	if role != "admin" && role != "readonly" {
		return fmt.Errorf("%w: %q", ErrInvalidRole, role)
	}
	return nil
}

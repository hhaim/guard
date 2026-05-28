package auth

import (
	"context"
	"errors"
	"log"
	"strings"

	"guard/internal/repo"
)

// DBUserSnapshot is a safe subset of app_users for diagnostics (no secrets).
type DBUserSnapshot struct {
	ClerkUserID string `json:"clerk_user_id"`
	Email       string `json:"email"`
	Role        string `json:"role"`
}

// AuthDiagnostics explains how Clerk sign-in maps to app_users (for support / AUTH_DEBUG).
type AuthDiagnostics struct {
	ClerkUserID         string          `json:"clerk_user_id"`
	Email               string          `json:"email"`
	Role                string          `json:"role"`
	SyncPath            string          `json:"sync_path"`
	DbByClerkID         *DBUserSnapshot `json:"db_by_clerk_id,omitempty"`
	DbByEmail           *DBUserSnapshot `json:"db_by_email,omitempty"`
	ClerkIDMatchesDB    bool            `json:"clerk_id_matches_db"`
	EmailMatchesDB      bool            `json:"email_matches_db"`
	BootstrapConfigured bool            `json:"bootstrap_configured"`
	BootstrapEmailMatch bool            `json:"bootstrap_email_match"`
	AdminCount          int64           `json:"admin_count"`
	HasPendingInvite    bool            `json:"has_pending_invite"`
	Errors              []string        `json:"errors,omitempty"`
}

func snapshot(u *repo.AppUser) *DBUserSnapshot {
	if u == nil {
		return nil
	}
	return &DBUserSnapshot{ClerkUserID: u.ClerkUserID, Email: u.Email, Role: u.Role}
}

// Diagnose runs read-only DB lookups for the signed-in Clerk user (no mutations).
func (s *Service) Diagnose(ctx context.Context, clerkUserID, email string) AuthDiagnostics {
	email = strings.ToLower(strings.TrimSpace(email))
	clerkUserID = strings.TrimSpace(clerkUserID)
	d := AuthDiagnostics{
		ClerkUserID:         clerkUserID,
		Email:               email,
		BootstrapConfigured: strings.TrimSpace(s.BootstrapAdminEmail) != "",
	}
	if d.BootstrapConfigured {
		d.BootstrapEmailMatch = strings.EqualFold(strings.TrimSpace(s.BootstrapAdminEmail), email)
	}

	if n, err := repo.CountAdmins(ctx, s.Pool); err != nil {
		d.Errors = append(d.Errors, "count_admins: "+err.Error())
	} else {
		d.AdminCount = n
	}

	if u, err := repo.GetUserByClerkID(ctx, s.Pool, clerkUserID); err == nil {
		d.DbByClerkID = snapshot(u)
		d.Role = u.Role
		d.SyncPath = "found_by_clerk_id"
		d.ClerkIDMatchesDB = true
		d.EmailMatchesDB = strings.EqualFold(u.Email, email)
	} else if !errors.Is(err, repo.ErrUserNotFound) {
		d.Errors = append(d.Errors, "get_by_clerk_id: "+err.Error())
	}

	if u, err := repo.GetUserByEmail(ctx, s.Pool, email); err == nil {
		d.DbByEmail = snapshot(u)
		if d.SyncPath == "" {
			if u.ClerkUserID == clerkUserID {
				d.SyncPath = "found_by_email_same_clerk_id"
			} else {
				d.SyncPath = "found_by_email_needs_rebind"
			}
			d.Role = u.Role
		}
		d.EmailMatchesDB = true
		if u.ClerkUserID == clerkUserID {
			d.ClerkIDMatchesDB = true
		}
	} else if !errors.Is(err, repo.ErrUserNotFound) {
		d.Errors = append(d.Errors, "get_by_email: "+err.Error())
	}

	if d.SyncPath == "" {
		if _, err := repo.GetPendingInviteByEmail(ctx, s.Pool, email); err == nil {
			d.HasPendingInvite = true
			d.SyncPath = "pending_invite_only"
		} else if !errors.Is(err, repo.ErrInviteNotFound) {
			d.Errors = append(d.Errors, "pending_invite: "+err.Error())
		} else if s.shouldBootstrapAdmin(ctx, email) {
			d.SyncPath = "would_bootstrap_admin"
		} else {
			d.SyncPath = "no_app_user"
		}
	}

	return d
}

func (s *Service) logAuth(step string, fields map[string]any) {
	if !s.Debug {
		return
	}
	log.Printf("auth debug: %s %+v", step, fields)
}

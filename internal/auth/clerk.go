package auth

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/clerk/clerk-sdk-go/v2"
	clerkhttp "github.com/clerk/clerk-sdk-go/v2/http"
	"github.com/clerk/clerk-sdk-go/v2/invitation"
	"github.com/clerk/clerk-sdk-go/v2/user"

	"guard/internal/db"
	"guard/internal/repo"
)

// Service wires Clerk JWT verification to Postgres user/invite sync and RBAC.
type Service struct {
	Pool                *db.Pool
	BootstrapAdminEmail string
	Debug               bool // AUTH_DEBUG=1: log steps and include debug in JSON errors
	AuthorizedParties   []string
}

func (s *Service) Middleware(next http.Handler) http.Handler {
	clerkHandler := clerkhttp.RequireHeaderAuthorization(s.clerkMiddlewareOpts()...)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, ok := clerk.SessionClaimsFromContext(r.Context())
		if !ok || claims == nil || claims.Subject == "" {
			s.logAuth("reject", map[string]any{"step": "no_session_claims", "path": r.URL.Path})
			writeJSONError(w, http.StatusUnauthorized, "unauthorized", nil)
			return
		}

		email, err := s.resolveEmail(r.Context(), claims.Subject)
		if err != nil || email == "" {
			s.logAuth("reject", map[string]any{
				"step": "resolve_email", "clerk_user_id": claims.Subject, "err": err, "path": r.URL.Path,
			})
			dbg := map[string]any{"step": "resolve_email", "clerk_user_id": claims.Subject}
			if err != nil {
				dbg["err"] = err.Error()
			}
			writeJSONError(w, http.StatusUnauthorized, "email required", dbg)
			return
		}

		appUser, err := s.syncUser(r.Context(), claims.Subject, email)
		if err != nil {
			s.logAuth("reject", map[string]any{
				"step": "sync_user", "clerk_user_id": claims.Subject, "email": email, "err": err,
			})
			writeJSONError(w, http.StatusInternalServerError, "user sync failed", map[string]any{
				"step": "sync_user", "err": err.Error(),
			})
			return
		}

		ctx := WithUser(r.Context(), appUser)
		r = r.WithContext(ctx)

		if appUser.Role == "" && !allowWithoutRole(r.Method, r.URL.Path) {
			diag := s.Diagnose(r.Context(), claims.Subject, email)
			s.logAuth("reject", map[string]any{
				"step": "not_invited", "clerk_user_id": claims.Subject, "email": email,
				"sync_path": diag.SyncPath, "path": r.URL.Path,
			})
			writeJSONError(w, http.StatusForbidden, "not invited", map[string]any{"diagnostics": diag})
			return
		}
		if RequireAdminRoute(r.URL.Path) && appUser.Role != "admin" {
			writeJSONError(w, http.StatusForbidden, "admin required", map[string]any{"role": appUser.Role})
			return
		}
		if !Authorize(appUser.Role, r.Method, r.URL.Path) {
			writeJSONError(w, http.StatusForbidden, "forbidden", map[string]any{
				"role": appUser.Role, "method": r.Method, "path": r.URL.Path,
			})
			return
		}

		if s.Debug && (r.URL.Path == "/api/me" || r.URL.Path == "/api/auth/debug") {
			log.Printf("auth debug: ok clerk_user_id=%s email=%s role=%s path=%s", appUser.ClerkUserID, appUser.Email, appUser.Role, r.URL.Path)
		}

		next.ServeHTTP(w, r)
	}))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == "/health" {
			next.ServeHTTP(w, r)
			return
		}
		clerkHandler.ServeHTTP(w, r)
	})
}

func (s *Service) syncUser(ctx context.Context, clerkUserID, email string) (*User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if u, err := repo.GetUserByClerkID(ctx, s.Pool, clerkUserID); err == nil {
		s.logAuth("sync", map[string]any{"path": "found_by_clerk_id", "role": u.Role, "email": u.Email})
		return &User{ClerkUserID: u.ClerkUserID, Email: u.Email, Role: u.Role}, nil
	} else if !errors.Is(err, repo.ErrUserNotFound) {
		return nil, err
	}

	// Same email, new Clerk user id (recreated Clerk user / new instance).
	if u, err := repo.GetUserByEmail(ctx, s.Pool, email); err == nil {
		if u.ClerkUserID != clerkUserID {
			s.logAuth("sync", map[string]any{"path": "rebind_clerk_id", "old": u.ClerkUserID, "new": clerkUserID})
			u, err = repo.RebindClerkUserID(ctx, s.Pool, email, clerkUserID)
			if err != nil {
				return nil, err
			}
		} else {
			s.logAuth("sync", map[string]any{"path": "found_by_email", "role": u.Role})
		}
		return &User{ClerkUserID: u.ClerkUserID, Email: u.Email, Role: u.Role}, nil
	} else if !errors.Is(err, repo.ErrUserNotFound) {
		return nil, err
	}

	if inv, err := repo.GetPendingInviteByEmail(ctx, s.Pool, email); err == nil {
		u, err := repo.UpsertFromInvite(ctx, s.Pool, clerkUserID, email, inv)
		if err != nil {
			return nil, err
		}
		s.logAuth("sync", map[string]any{"path": "from_invite", "role": u.Role})
		return &User{ClerkUserID: u.ClerkUserID, Email: u.Email, Role: u.Role}, nil
	} else if !errors.Is(err, repo.ErrInviteNotFound) {
		return nil, err
	}

	if s.shouldBootstrapAdmin(ctx, email) {
		u, err := repo.CreateAppUser(ctx, s.Pool, clerkUserID, email, "admin", nil)
		if err != nil {
			return nil, err
		}
		s.logAuth("sync", map[string]any{"path": "bootstrap_admin", "role": u.Role})
		return &User{ClerkUserID: u.ClerkUserID, Email: u.Email, Role: u.Role}, nil
	}

	s.logAuth("sync", map[string]any{"path": "no_role", "email": email})
	return &User{ClerkUserID: clerkUserID, Email: email, Role: ""}, nil
}

func (s *Service) shouldBootstrapAdmin(ctx context.Context, email string) bool {
	bootstrap := strings.ToLower(strings.TrimSpace(s.BootstrapAdminEmail))
	if bootstrap == "" || strings.ToLower(strings.TrimSpace(email)) != bootstrap {
		return false
	}
	n, err := repo.CountAdmins(ctx, s.Pool)
	return err == nil && n == 0
}

func (s *Service) resolveEmail(ctx context.Context, clerkUserID string) (string, error) {
	u, err := user.Get(ctx, clerkUserID)
	if err != nil {
		return "", err
	}
	if u.PrimaryEmailAddressID != nil {
		for _, ea := range u.EmailAddresses {
			if ea != nil && ea.ID == *u.PrimaryEmailAddressID && ea.EmailAddress != "" {
				return ea.EmailAddress, nil
			}
		}
	}
	for _, ea := range u.EmailAddresses {
		if ea != nil && ea.EmailAddress != "" {
			return ea.EmailAddress, nil
		}
	}
	return "", errors.New("no email on clerk user")
}

// CreateClerkInvitation sends a Clerk dashboard invitation for the email.
func CreateClerkInvitation(ctx context.Context, email string) (string, error) {
	notify := true
	inv, err := invitation.Create(ctx, &invitation.CreateParams{
		EmailAddress: email,
		Notify:       &notify,
	})
	if err != nil {
		return "", err
	}
	if inv == nil || inv.ID == "" {
		return "", errors.New("empty clerk invitation id")
	}
	return inv.ID, nil
}

// allowWithoutRole lets signed-in users load profile before an invite is accepted.
func allowWithoutRole(method, path string) bool {
	if method != http.MethodGet {
		return false
	}
	return path == "/api/me" || path == "/api/auth/debug"
}

func writeJSONError(w http.ResponseWriter, status int, msg string, debug map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	body := map[string]any{"error": msg}
	if len(debug) > 0 {
		body["debug"] = debug
	}
	_ = json.NewEncoder(w).Encode(body)
}

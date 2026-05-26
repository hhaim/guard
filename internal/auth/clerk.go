package auth

import (
	"context"
	"encoding/json"
	"errors"
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
}

func (s *Service) Middleware(next http.Handler) http.Handler {
	clerkHandler := clerkhttp.RequireHeaderAuthorization()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, ok := clerk.SessionClaimsFromContext(r.Context())
		if !ok || claims == nil || claims.Subject == "" {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}

		email, err := s.resolveEmail(r.Context(), claims.Subject)
		if err != nil || email == "" {
			writeJSONError(w, http.StatusUnauthorized, "email required")
			return
		}

		appUser, err := s.syncUser(r.Context(), claims.Subject, email)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "user sync failed")
			return
		}

		ctx := WithUser(r.Context(), appUser)
		r = r.WithContext(ctx)

		if appUser.Role == "" {
			writeJSONError(w, http.StatusForbidden, "not invited")
			return
		}
		if RequireAdminRoute(r.URL.Path) && appUser.Role != "admin" {
			writeJSONError(w, http.StatusForbidden, "admin required")
			return
		}
		if !Authorize(appUser.Role, r.Method, r.URL.Path) {
			writeJSONError(w, http.StatusForbidden, "forbidden")
			return
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
		return &User{ClerkUserID: u.ClerkUserID, Email: u.Email, Role: u.Role}, nil
	} else if !errors.Is(err, repo.ErrUserNotFound) {
		return nil, err
	}

	if inv, err := repo.GetPendingInviteByEmail(ctx, s.Pool, email); err == nil {
		u, err := repo.UpsertFromInvite(ctx, s.Pool, clerkUserID, email, inv)
		if err != nil {
			return nil, err
		}
		return &User{ClerkUserID: u.ClerkUserID, Email: u.Email, Role: u.Role}, nil
	} else if !errors.Is(err, repo.ErrInviteNotFound) {
		return nil, err
	}

	if s.shouldBootstrapAdmin(ctx, email) {
		u, err := repo.CreateAppUser(ctx, s.Pool, clerkUserID, email, "admin", nil)
		if err != nil {
			return nil, err
		}
		return &User{ClerkUserID: u.ClerkUserID, Email: u.Email, Role: u.Role}, nil
	}

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

func writeJSONError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

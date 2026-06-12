package auth

import "context"

type ctxKey int

const userKey ctxKey = 1

// User is the authenticated application user after Clerk JWT verification and DB sync.
type User struct {
	ClerkUserID string
	Email       string
	Role        string // admin, readonly, or empty when not provisioned
}

func WithUser(ctx context.Context, u *User) context.Context {
	return context.WithValue(ctx, userKey, u)
}

func UserFromContext(ctx context.Context) (*User, bool) {
	u, ok := ctx.Value(userKey).(*User)
	return u, ok && u != nil
}

// Actor returns a stable audit identifier (email preferred).
func Actor(ctx context.Context) string {
	if u, ok := UserFromContext(ctx); ok && u.Email != "" {
		return u.Email
	}
	if u, ok := UserFromContext(ctx); ok && u.ClerkUserID != "" {
		return u.ClerkUserID
	}
	return ""
}

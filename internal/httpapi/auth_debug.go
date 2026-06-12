package httpapi

import (
	"encoding/json"
	"net/http"

	"guard/internal/auth"
)

func (s *Server) handleAuthDebug(w http.ResponseWriter, r *http.Request) {
	if s.Auth == nil {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error": "clerk auth disabled (CLERK_SECRET_KEY not set on API)",
			"hint":  "Set CLERK_SECRET_KEY to the secret for the same Clerk app as VITE_CLERK_PUBLISHABLE_KEY",
		})
		return
	}
	u, ok := auth.UserFromContext(r.Context())
	if !ok || u == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error": "unauthorized",
			"hint":  "Clerk JWT was not verified — see GET /api/me response body or enable AUTH_DEBUG=1 on the API",
		})
		return
	}
	diag := s.Auth.Diagnose(r.Context(), u.ClerkUserID, u.Email)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"session": map[string]string{
			"clerk_user_id": u.ClerkUserID,
			"email":         u.Email,
			"role":          u.Role,
		},
		"diagnostics": diag,
	})
}

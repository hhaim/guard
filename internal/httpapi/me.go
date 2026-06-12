package httpapi

import (
	"encoding/json"
	"net/http"

	"guard/internal/auth"
)

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromContext(r.Context())
	if !ok || u == nil {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	out := map[string]any{
		"clerk_user_id": u.ClerkUserID,
		"email":         u.Email,
		"role":          u.Role,
	}
	if s.Auth != nil {
		out["diagnostics"] = s.Auth.Diagnose(r.Context(), u.ClerkUserID, u.Email)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

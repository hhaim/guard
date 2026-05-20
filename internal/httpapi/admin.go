package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"guard/internal/auth"
	"guard/internal/repo"
)

func (s *Server) handleAdminListInvites(w http.ResponseWriter, r *http.Request) {
	invites, err := repo.ListInvites(r.Context(), s.Pool)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	type row struct {
		ID                int64   `json:"id"`
		Email             string  `json:"email"`
		Role              string  `json:"role"`
		InvitedBy         string  `json:"invited_by"`
		ClerkInvitationID *string `json:"clerk_invitation_id,omitempty"`
		CreatedAt         string  `json:"created_at"`
		AcceptedAt        *string `json:"accepted_at,omitempty"`
		Pending           bool    `json:"pending"`
	}
	out := make([]row, 0, len(invites))
	for _, inv := range invites {
		var accepted *string
		if inv.AcceptedAt != nil {
			s := inv.AcceptedAt.UTC().Format("2006-01-02T15:04:05Z07:00")
			accepted = &s
		}
		out = append(out, row{
			ID:                inv.ID,
			Email:             inv.Email,
			Role:              inv.Role,
			InvitedBy:         inv.InvitedBy,
			ClerkInvitationID: inv.ClerkInvitationID,
			CreatedAt:         inv.CreatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
			AcceptedAt:        accepted,
			Pending:           inv.AcceptedAt == nil,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

type createInviteBody struct {
	Email string `json:"email"`
	Role  string `json:"role"`
}

func (s *Server) handleAdminCreateInvite(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromContext(r.Context())
	if !ok || u.Role != "admin" {
		http.Error(w, `{"error":"admin required"}`, http.StatusForbidden)
		return
	}
	var body createInviteBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	email := strings.TrimSpace(body.Email)
	role := strings.TrimSpace(body.Role)
	if email == "" || role == "" {
		http.Error(w, `{"error":"email and role required"}`, http.StatusBadRequest)
		return
	}
	if err := repo.ValidateRole(role); err != nil {
		http.Error(w, `{"error":"role must be admin or readonly"}`, http.StatusBadRequest)
		return
	}

	clerkInvID, err := auth.CreateClerkInvitation(r.Context(), email)
	if err != nil {
		http.Error(w, `{"error":"clerk invitation failed"}`, http.StatusBadGateway)
		return
	}
	cid := clerkInvID
	inv, err := repo.CreateInvite(r.Context(), s.Pool, email, role, u.ClerkUserID, &cid)
	if err != nil {
		if errors.Is(err, repo.ErrDuplicateEmail) {
			http.Error(w, `{"error":"email already invited or registered"}`, http.StatusConflict)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"id":                  inv.ID,
		"email":               inv.Email,
		"role":                inv.Role,
		"clerk_invitation_id": inv.ClerkInvitationID,
	})
}

func (s *Server) handleAdminDeleteInvite(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || id <= 0 {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}
	if err := repo.DeletePendingInvite(r.Context(), s.Pool, id); err != nil {
		if errors.Is(err, repo.ErrInviteNotFound) {
			http.Error(w, `{"error":"invite not found"}`, http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

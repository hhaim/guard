package httpapi

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"guard/internal/repo"
	"guard/internal/timezones"
)

// GET /api/time-zones — current document and optimistic-lock version.
func (s *Server) handleTimeZonesGet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	row, err := repo.GetCfg(r.Context(), s.Pool, timezones.CfgKey)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	doc, err := timezones.ParseDoc(row.Value)
	if err != nil {
		http.Error(w, fmt.Sprintf("invalid stored %s: %v", timezones.CfgKey, err), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"zones": doc.Zones, "version": row.Version, "updated_at": row.UpdatedAt,
	})
}

type timeZonesCreateBody struct {
	ExpectedVersion *int64         `json:"expected_version"`
	Zone            timezones.Zone `json:"zone"`
}

// POST /api/time-zones — append a zone; writes cfg + audit.
func (s *Server) handleTimeZonesCreate(w http.ResponseWriter, r *http.Request) {
	if !s.auth(w, r) {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body timeZonesCreateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if body.ExpectedVersion == nil {
		http.Error(w, `{"error":"expected_version required (use 0 if key is new)"}`, http.StatusBadRequest)
		return
	}
	iana := strings.TrimSpace(body.Zone.IANA)
	if iana == "" {
		http.Error(w, `{"error":"zone.iana required"}`, http.StatusBadRequest)
		return
	}
	id := strings.TrimSpace(body.Zone.ID)
	if id == "" {
		var b [4]byte
		if _, err := rand.Read(b[:]); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		id = hex.EncodeToString(b[:])
	}
	newZ := timezones.Zone{ID: id, Label: strings.TrimSpace(body.Zone.Label), IANA: iana}
	if _, err := time.LoadLocation(newZ.IANA); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"invalid iana: %v"}`, err), http.StatusBadRequest)
		return
	}

	tx, err := s.Pool.Begin(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(r.Context())

	row, err := repo.GetCfgForUpdate(r.Context(), tx, timezones.CfgKey)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	doc, err := timezones.ParseDoc(row.Value)
	if err != nil {
		http.Error(w, fmt.Sprintf("invalid stored %s: %v", timezones.CfgKey, err), http.StatusInternalServerError)
		return
	}
	for _, z := range doc.Zones {
		if z.ID == newZ.ID {
			http.Error(w, `{"error":"id already exists"}`, http.StatusConflict)
			return
		}
	}
	doc.Zones = append(doc.Zones, newZ)
	doc.UpdateTS = time.Now().UTC().Format(time.RFC3339)
	raw, err := doc.ToJSON()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	out, err := repo.PutCfg(r.Context(), tx, timezones.CfgKey, raw, body.ExpectedVersion)
	if errors.Is(err, repo.ErrVersionConflict) {
		http.Error(w, `{"error":"version_conflict"}`, http.StatusConflict)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := repo.AppendAudit(r.Context(), tx, timezones.CfgKey, raw); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"zones": doc.Zones, "version": out.Version, "updated_at": out.UpdatedAt,
	})
}

type timeZonesPatchBody struct {
	ExpectedVersion *int64  `json:"expected_version"`
	Label           *string `json:"label"`
	IANA            *string `json:"iana"`
}

// PATCH /api/time-zones/{id}
func (s *Server) handleTimeZonesPatch(w http.ResponseWriter, r *http.Request) {
	if !s.auth(w, r) {
		return
	}
	if r.Method != http.MethodPatch {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		http.Error(w, "missing id", http.StatusBadRequest)
		return
	}
	var body timeZonesPatchBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if body.ExpectedVersion == nil {
		http.Error(w, `{"error":"expected_version required"}`, http.StatusBadRequest)
		return
	}
	if body.Label == nil && body.IANA == nil {
		http.Error(w, `{"error":"provide label and/or iana"}`, http.StatusBadRequest)
		return
	}

	tx, err := s.Pool.Begin(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(r.Context())

	row, err := repo.GetCfgForUpdate(r.Context(), tx, timezones.CfgKey)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	doc, err := timezones.ParseDoc(row.Value)
	if err != nil {
		http.Error(w, fmt.Sprintf("invalid stored %s: %v", timezones.CfgKey, err), http.StatusInternalServerError)
		return
	}
	found := false
	for i := range doc.Zones {
		if doc.Zones[i].ID != id {
			continue
		}
		found = true
		if body.Label != nil {
			doc.Zones[i].Label = strings.TrimSpace(*body.Label)
		}
		if body.IANA != nil {
			doc.Zones[i].IANA = strings.TrimSpace(*body.IANA)
		}
		if _, err := time.LoadLocation(doc.Zones[i].IANA); err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"invalid iana: %v"}`, err), http.StatusBadRequest)
			return
		}
		break
	}
	if !found {
		http.Error(w, `{"error":"not_found"}`, http.StatusNotFound)
		return
	}
	doc.UpdateTS = time.Now().UTC().Format(time.RFC3339)
	raw, err := doc.ToJSON()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	out, err := repo.PutCfg(r.Context(), tx, timezones.CfgKey, raw, body.ExpectedVersion)
	if errors.Is(err, repo.ErrVersionConflict) {
		http.Error(w, `{"error":"version_conflict"}`, http.StatusConflict)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := repo.AppendAudit(r.Context(), tx, timezones.CfgKey, raw); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"zones": doc.Zones, "version": out.Version, "updated_at": out.UpdatedAt,
	})
}

// DELETE /api/time-zones/{id}?expected_version=N
func (s *Server) handleTimeZonesDelete(w http.ResponseWriter, r *http.Request) {
	if !s.auth(w, r) {
		return
	}
	if r.Method != http.MethodDelete {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		http.Error(w, "missing id", http.StatusBadRequest)
		return
	}
	evs := r.URL.Query().Get("expected_version")
	if evs == "" {
		http.Error(w, `{"error":"expected_version query param required"}`, http.StatusBadRequest)
		return
	}
	ev, err := strconv.ParseInt(evs, 10, 64)
	if err != nil {
		http.Error(w, `{"error":"invalid expected_version"}`, http.StatusBadRequest)
		return
	}

	tx, err := s.Pool.Begin(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(r.Context())

	row, err := repo.GetCfgForUpdate(r.Context(), tx, timezones.CfgKey)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	doc, err := timezones.ParseDoc(row.Value)
	if err != nil {
		http.Error(w, fmt.Sprintf("invalid stored %s: %v", timezones.CfgKey, err), http.StatusInternalServerError)
		return
	}
	var next []timezones.Zone
	found := false
	for _, z := range doc.Zones {
		if z.ID == id {
			found = true
			continue
		}
		next = append(next, z)
	}
	if !found {
		http.Error(w, `{"error":"not_found"}`, http.StatusNotFound)
		return
	}
	doc.Zones = next
	doc.UpdateTS = time.Now().UTC().Format(time.RFC3339)
	raw, err := doc.ToJSON()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	out, err := repo.PutCfg(r.Context(), tx, timezones.CfgKey, raw, &ev)
	if errors.Is(err, repo.ErrVersionConflict) {
		http.Error(w, `{"error":"version_conflict"}`, http.StatusConflict)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := repo.AppendAudit(r.Context(), tx, timezones.CfgKey, raw); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"zones": doc.Zones, "version": out.Version, "updated_at": out.UpdatedAt,
	})
}

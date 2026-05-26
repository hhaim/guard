package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"gopkg.in/yaml.v3"

	"guard/internal/auth"
	"guard/internal/db"
	"guard/internal/repo"
)

// Server wires HTTP routes to the database pool.
type Server struct {
	Pool   *db.Pool
	APIKey string // legacy: X-API-Key when Clerk auth is disabled
	Auth   *auth.Service

	// PlanDebugDayOffset shifts "effective today" forward for planning (debug/testing).
	PlanDebugDayOffset int
	// AllowDebugOffset enables per-request debug_day_offset on plan/schedule APIs.
	AllowDebugOffset bool
}

func (s *Server) clerkEnabled() bool {
	return s.Auth != nil
}

func (s *Server) auth(w http.ResponseWriter, r *http.Request) bool {
	if s.clerkEnabled() {
		return true
	}
	if s.APIKey == "" {
		return true
	}
	if r.Header.Get("X-API-Key") != s.APIKey {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return false
	}
	return true
}

func (s *Server) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /api/cfg/{key}", s.handleGetCfg)
	mux.HandleFunc("PUT /api/cfg/{key}", s.handlePutCfg)
	mux.HandleFunc("GET /api/time-zones", s.handleTimeZonesGet)
	mux.HandleFunc("POST /api/time-zones", s.handleTimeZonesCreate)
	mux.HandleFunc("PATCH /api/time-zones/{id}", s.handleTimeZonesPatch)
	mux.HandleFunc("DELETE /api/time-zones/{id}", s.handleTimeZonesDelete)
	mux.HandleFunc("POST /api/schedule/run", s.handleScheduleRun)
	mux.HandleFunc("GET /api/plan/context", s.handlePlanContext)
	mux.HandleFunc("GET /api/plan/proposals", s.handlePlanListProposals)
	mux.HandleFunc("GET /api/plan/proposals/{slot}", s.handlePlanGetProposal)
	mux.HandleFunc("POST /api/plan/generate", s.handlePlanGenerate)
	mux.HandleFunc("PUT /api/plan/proposals/{slot}", s.handlePlanPutProposal)
	mux.HandleFunc("DELETE /api/plan/proposals/{slot}", s.handlePlanDeleteProposal)
	mux.HandleFunc("POST /api/plan/apply", s.handlePlanApply)
	mux.HandleFunc("DELETE /api/schedule", s.handleScheduleDelete)
	mux.HandleFunc("GET /api/reports/schedule", s.handleReportSchedule)
	mux.HandleFunc("GET /api/reports/blocks", s.handleReportBlocks)
	mux.HandleFunc("GET /api/soldiers", s.handleSoldiersList)
	mux.HandleFunc("GET /api/soldiers/status", s.handleSoldiersStatusList)
	mux.HandleFunc("POST /api/soldiers/status", s.handleSoldiersStatusCreate)
	mux.HandleFunc("POST /api/soldiers/status/clear", s.handleSoldiersStatusClear)
	mux.HandleFunc("PATCH /api/soldiers/status/{id}", s.handleSoldiersStatusPatch)
	mux.HandleFunc("DELETE /api/soldiers/status/{id}", s.handleSoldiersStatusDelete)
	mux.HandleFunc("GET /api/plan/preview-availability", s.handlePlanPreviewAvailability)
	mux.HandleFunc("GET /api/me", s.handleMe)
	mux.HandleFunc("GET /api/admin/invites", s.handleAdminListInvites)
	mux.HandleFunc("POST /api/admin/invites", s.handleAdminCreateInvite)
	mux.HandleFunc("DELETE /api/admin/invites/{id}", s.handleAdminDeleteInvite)
}

// Handler returns the API mux, wrapped with Clerk auth when configured.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	s.Register(mux)
	if s.Auth != nil {
		return s.Auth.Middleware(mux)
	}
	return mux
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"status": "ok"})
}

func (s *Server) handleGetCfg(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	if key == "" {
		http.Error(w, "missing key", http.StatusBadRequest)
		return
	}
	row, err := repo.GetCfg(r.Context(), s.Pool, key)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"key": row.Key, "value": json.RawMessage(row.Value), "version": row.Version, "updated_at": row.UpdatedAt,
	})
}

type putCfgBody struct {
	Value            json.RawMessage `json:"value"`
	ExpectedVersion  *int64          `json:"expected_version"`
}

func (s *Server) handlePutCfg(w http.ResponseWriter, r *http.Request) {
	if !s.auth(w, r) {
		return
	}
	key := r.PathValue("key")
	var body putCfgBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if body.ExpectedVersion == nil {
		http.Error(w, `{"error":"expected_version required (use 0 for first write of a key)"}`, http.StatusBadRequest)
		return
	}
	tx, err := s.Pool.Begin(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(r.Context())
	row, err := repo.PutCfg(r.Context(), tx, key, body.Value, body.ExpectedVersion)
	if errors.Is(err, repo.ErrVersionConflict) {
		http.Error(w, `{"error":"version_conflict"}`, http.StatusConflict)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := repo.AppendAudit(r.Context(), tx, key, body.Value, auth.Actor(r.Context())); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"key": row.Key, "version": row.Version, "updated_at": row.UpdatedAt})
}

// handleScheduleRun is a compatibility alias for POST /api/plan/generate (slot 01, cfg only).
func (s *Server) handleScheduleRun(w http.ResponseWriter, r *http.Request) {
	if !s.auth(w, r) {
		return
	}
	var body scheduleRunBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid JSON body"}`, http.StatusBadRequest)
		return
	}
	genBody, _ := json.Marshal(planGenerateBody{scheduleRunBody: body, Slot: "01"})
	r2 := r.Clone(r.Context())
	r2.Body = io.NopCloser(bytes.NewReader(genBody))
	r2.ContentLength = int64(len(genBody))
	s.handlePlanGenerate(w, r2)
}

func countYAMLSlots(raw []byte) int {
	var root map[string]any
	if err := yaml.Unmarshal(raw, &root); err != nil {
		return -1
	}
	slots, _ := root["slots"].([]any)
	if len(slots) > 0 {
		return len(slots)
	}
	sl2, _ := root["slot_locations"].([]any)
	return len(sl2)
}

func (s *Server) handleReportSchedule(w http.ResponseWriter, r *http.Request) {
	fromS := r.URL.Query().Get("from")
	toS := r.URL.Query().Get("to")
	if fromS == "" || toS == "" {
		http.Error(w, `{"error":"from and to query params required (YYYY-MM-DD)"}`, http.StatusBadRequest)
		return
	}
	from, err := time.Parse("2006-01-02", fromS)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	to, err := time.Parse("2006-01-02", toS)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	doc, err := repo.MergeScheduleRange(r.Context(), s.Pool, from, to)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(doc)
}

func (s *Server) handleReportBlocks(w http.ResponseWriter, r *http.Request) {
	fromS := r.URL.Query().Get("from")
	toS := r.URL.Query().Get("to")
	if fromS == "" || toS == "" {
		http.Error(w, `{"error":"from and to required"}`, http.StatusBadRequest)
		return
	}
	from, err := time.Parse("2006-01-02", fromS)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	to, err := time.Parse("2006-01-02", toS)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	data, err := repo.ReportBlocksBySoldierDate(r.Context(), s.Pool, from, to)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(data)
}


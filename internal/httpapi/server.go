package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"gopkg.in/yaml.v3"

	"guard/guardsched"
	"guard/internal/db"
	"guard/internal/repo"
	"guard/internal/schedule"
)

// Server wires HTTP routes to the database pool.
type Server struct {
	Pool   *db.Pool
	APIKey string // optional; if set, require X-API-Key header match
}

func (s *Server) auth(w http.ResponseWriter, r *http.Request) bool {
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
	mux.HandleFunc("GET /api/reports/schedule", s.handleReportSchedule)
	mux.HandleFunc("GET /api/reports/blocks", s.handleReportBlocks)
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
	if err := repo.AppendAudit(r.Context(), tx, key, body.Value); err != nil {
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

type scheduleRunBody struct {
	AnchorDate              string   `json:"anchor_date"` // YYYY-MM-DD
	Days                    int      `json:"days"`
	Seed                    *int64   `json:"seed"`
	ShiftHours              *float64 `json:"shift_hours"`
	MinConsecutiveFreeHours *float64 `json:"min_consecutive_free_hours"`
	MinFreeShiftsAfterDuty  *int     `json:"min_free_shifts_after_duty"`
	BandRelative            *float64 `json:"band_relative"`
	SimTrials               *int     `json:"sim_trials"`
}

func (s *Server) handleScheduleRun(w http.ResponseWriter, r *http.Request) {
	if !s.auth(w, r) {
		return
	}
	var body scheduleRunBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid JSON body"}`, http.StatusBadRequest)
		return
	}
	if body.Days <= 0 {
		body.Days = 1
	}
	anchor, err := time.Parse("2006-01-02", strings.TrimSpace(body.AnchorDate))
	if err != nil || strings.TrimSpace(body.AnchorDate) == "" {
		anchor = time.Now().UTC().Truncate(24 * time.Hour)
	}

	ctx := r.Context()
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	slotsRow, err := repo.GetCfg(ctx, s.Pool, "slots")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	soldiersRow, err := repo.GetCfg(ctx, s.Pool, "soldiers")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	globalRow, err := repo.GetCfg(ctx, s.Pool, "global")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	var global struct {
		HistoryDays int   `json:"history_days"`
		RandomSeed  int64 `json:"random_seed"`
	}
	_ = json.Unmarshal(globalRow.Value, &global)
	if global.HistoryDays > 0 && body.Days > global.HistoryDays {
		body.Days = global.HistoryDays
	}
	var seedPtr *int64
	if body.Seed != nil {
		seedPtr = body.Seed
	} else if global.RandomSeed != 0 {
		s := global.RandomSeed
		seedPtr = &s
	}

	trials := 1
	if body.SimTrials != nil && *body.SimTrials > 0 {
		trials = *body.SimTrials
	}
	if trials > 1 && seedPtr == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": "sim_trials > 1 requires seed"})
		return
	}

	minFreeH := 6.0
	if body.MinConsecutiveFreeHours != nil {
		minFreeH = *body.MinConsecutiveFreeHours
	}
	minCool := 2
	if body.MinFreeShiftsAfterDuty != nil {
		minCool = *body.MinFreeShiftsAfterDuty
	}
	bandRel := 0.2
	if body.BandRelative != nil {
		bandRel = *body.BandRelative
	}

	var slotsDoc struct {
		ZonesYAML string `json:"zones_yaml"`
	}
	_ = json.Unmarshal(slotsRow.Value, &slotsDoc)
	yamlBytes := []byte(strings.TrimSpace(slotsDoc.ZonesYAML))
	if len(yamlBytes) == 0 {
		var raw any
		if err := json.Unmarshal(slotsRow.Value, &raw); err == nil {
			if s, ok := raw.(string); ok {
				yamlBytes = []byte(strings.TrimSpace(s))
			}
		}
	}
	if len(yamlBytes) == 0 {
		http.Error(w, `{"error":"slots must include zones_yaml string or be a raw YAML string"}`, http.StatusBadRequest)
		return
	}

	var soldiersDoc struct {
		Soldiers []struct {
			ID       string `json:"id"`
			Key      string `json:"key"`
			FullName string `json:"full_name"`
			State    string `json:"state"`
		} `json:"soldiers"`
	}
	if err := json.Unmarshal(soldiersRow.Value, &soldiersDoc); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	var keys []string
	for _, s := range soldiersDoc.Soldiers {
		id := s.ID
		if id == "" {
			id = s.Key
		}
		if id == "" {
			continue
		}
		st := strings.ToLower(strings.TrimSpace(s.State))
		if st != "" && st != "base" {
			continue
		}
		keys = append(keys, id)
	}
	if len(keys) < 1 {
		http.Error(w, `{"error":"need at least one base soldier"}`, http.StatusBadRequest)
		return
	}

	slotsPerBlock := countYAMLSlots(yamlBytes)
	if slotsPerBlock < 1 {
		http.Error(w, `{"error":"could not determine slots count from YAML"}`, http.StatusBadRequest)
		return
	}
	if len(keys) < slotsPerBlock {
		http.Error(w, fmt.Sprintf(`{"error":"need at least %d base soldiers"}`, slotsPerBlock), http.StatusBadRequest)
		return
	}

	zc, err := guardsched.LoadZoneConfigYAML(yamlBytes, slotsPerBlock, body.ShiftHours)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
		return
	}

	recs, stats, trialMeta, err := guardsched.RunSimulationBestOfZoneConfig(
		zc, len(keys), body.Days, trials, seedPtr,
		minFreeH, true, 0, 2, minCool, bandRel,
	)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnprocessableEntity)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
		return
	}

	slotLabels := make([]string, len(zc.Slots))
	for i, sl := range zc.Slots {
		slotLabels[i] = sl.DisplayName
	}

	bp, _ := guardsched.CalendarBlocksPerDaySafe(zc.ShiftHours)
	rows, err := schedule.ToScheduleRows(schedule.PersistInput{
		AnchorDate: anchor, BlockHours: zc.ShiftHours, BlocksPerDay: bp,
		SoldierKeys: keys, SlotLabels: slotLabels, Records: recs,
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	endDate := anchor.AddDate(0, 0, body.Days-1)
	if err := repo.DeleteScheduleRange(ctx, tx, anchor, endDate); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := repo.InsertScheduleRows(ctx, tx, rows); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	summary, _ := json.Marshal(map[string]any{
		"shift_cooldown_exclusions": stats.ShiftCooldownExclusions,
		"shift_cooldown_pool_iterations": stats.ShiftCooldownPoolIterations,
		"assignments": len(recs),
	})
	if err := repo.UpsertCfg(ctx, tx, "last_run_summary", summary); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	assignJSON := guardsched.AssignmentRecordsToJSON(recs, keys)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":          true,
		"days":        body.Days,
		"anchor_date": anchor.Format("2006-01-02"),
		"shift_hours": zc.ShiftHours,
		"assignments": assignJSON,
		"count":       len(assignJSON),
		"meta": map[string]any{
			"sim_trials":                     trials,
			"trial":                          trialMeta,
			"min_consecutive_free_hours":     minFreeH,
			"min_free_shifts_after_duty":     minCool,
			"band_relative":                  bandRel,
			"shift_cooldown_exclusions":      stats.ShiftCooldownExclusions,
			"shift_cooldown_pool_iterations": stats.ShiftCooldownPoolIterations,
		},
	})
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
	rows, err := s.Pool.Query(r.Context(),
		`SELECT ts_date, day_index, slot, shift_index, shift_start, shift_end, soldier_id, meta
		 FROM schedule WHERE ts_date >= $1::date AND ts_date <= $2::date ORDER BY ts_date, shift_index, slot`,
		from, to)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	type row struct {
		TsDate     time.Time       `json:"ts_date"`
		DayIndex   int             `json:"day_index"`
		Slot       string          `json:"slot"`
		ShiftIndex int             `json:"shift_index"`
		ShiftStart string          `json:"shift_start"`
		ShiftEnd   string          `json:"shift_end"`
		SoldierID  string          `json:"soldier_id"`
		Meta       json.RawMessage `json:"meta"`
	}
	var out []row
	for rows.Next() {
		var v row
		var ss, se time.Time
		if err := rows.Scan(&v.TsDate, &v.DayIndex, &v.Slot, &v.ShiftIndex, &ss, &se, &v.SoldierID, &v.Meta); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		v.ShiftStart = ss.Format("15:04:05")
		v.ShiftEnd = se.Format("15:04:05")
		out = append(out, v)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
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


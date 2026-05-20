package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"guard/guardsched"
	"guard/internal/repo"
	"guard/internal/schedule"
)

const proposalFormatVersion = 1

type planChange struct {
	TsDate       string `json:"ts_date"`
	Slot         string `json:"slot"`
	ShiftIndex   int    `json:"shift_index"`
	ShiftLabel   string `json:"shift_label,omitempty"`
	OldSoldierID string `json:"old_soldier_id"`
	NewSoldierID string `json:"new_soldier_id"`
}

type proposalDoc struct {
	FormatVersion int              `json:"format_version"`
	AnchorDate    string           `json:"anchor_date"`
	Days          int              `json:"days"`
	ShiftHours    float64          `json:"shift_hours"`
	Assignments   []map[string]any `json:"assignments"`
	Meta          map[string]any   `json:"meta,omitempty"`
	Changes       []planChange     `json:"changes,omitempty"`
	UpdatedAt     string           `json:"updated_at,omitempty"`
}

type planGenerateBody struct {
	scheduleRunBody
	Slot string `json:"slot"`
}

type planPutBody struct {
	ExpectedVersion *int64 `json:"expected_version"`
	proposalDoc
}

type planApplyBody struct {
	AnchorDate     string `json:"anchor_date"`
	Slot           string `json:"slot"`
	DebugDayOffset *int   `json:"debug_day_offset,omitempty"`
}

func buildProposalFromSim(out *simRunOutput, changes []planChange) proposalDoc {
	return proposalDoc{
		FormatVersion: proposalFormatVersion,
		AnchorDate:    out.Anchor.Format("2006-01-02"),
		Days:          out.Days,
		ShiftHours:    out.ShiftHours,
		Assignments:   out.AssignJSON,
		Meta:          out.Meta,
		Changes:       changes,
		UpdatedAt:     time.Now().UTC().Format(time.RFC3339),
	}
}

func (s *Server) handlePlanContext(w http.ResponseWriter, r *http.Request) {
	offset := s.resolvePlanDebugOffset(r.Context(), r, nil)
	cfgOff := s.globalPlanDebugOffset(r.Context())
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"utc_today":            utcToday().Format("2006-01-02"),
		"effective_today":      s.effectiveTodayUTC(offset).Format("2006-01-02"),
		"plan_anchor":          s.allowedPlanAnchor(offset).Format("2006-01-02"),
		"debug_day_offset":     s.planDebugOffset(offset),
		"server_day_offset":    s.PlanDebugDayOffset,
		"config_day_offset":    cfgOff,
		"request_day_offset":   offset,
		"allow_debug_offset":   s.AllowDebugOffset,
	})
}

func (s *Server) handlePlanListProposals(w http.ResponseWriter, r *http.Request) {
	anchorS := strings.TrimSpace(r.URL.Query().Get("anchor"))
	if anchorS == "" {
		http.Error(w, `{"error":"anchor query param required (YYYY-MM-DD)"}`, http.StatusBadRequest)
		return
	}
	anchor, err := parseAnchorDate(anchorS)
	if err != nil {
		http.Error(w, `{"error":"invalid anchor"}`, http.StatusBadRequest)
		return
	}
	extra := s.resolvePlanDebugOffset(r.Context(), r, nil)
	if err := s.validatePlanAnchor(anchor, extra); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
		return
	}

	prefix := fmt.Sprintf("proposal-%s-", anchor.Format("2006-01-02"))
	keys, err := repo.ListCfgKeys(r.Context(), s.Pool, prefix)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	existing := make(map[string]*repo.CfgRow)
	for _, k := range keys {
		row, err := repo.GetCfg(r.Context(), s.Pool, k)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		slot := strings.TrimPrefix(k, prefix)
		existing[slot] = row
	}

	type slotInfo struct {
		Slot            string `json:"slot"`
		Exists          bool   `json:"exists"`
		UpdatedAt       string `json:"updated_at,omitempty"`
		AssignmentCount int    `json:"assignment_count"`
		Version         int64  `json:"version,omitempty"`
	}
	slots := make([]slotInfo, 0, 4)
	for _, slot := range []string{"01", "02", "03", "04"} {
		info := slotInfo{Slot: slot, Exists: false}
		if row, ok := existing[slot]; ok && row.Version > 0 {
			info.Exists = true
			info.UpdatedAt = row.UpdatedAt.UTC().Format(time.RFC3339)
			info.Version = row.Version
			var doc proposalDoc
			if err := json.Unmarshal(row.Value, &doc); err == nil {
				info.AssignmentCount = len(doc.Assignments)
			}
		}
		slots = append(slots, info)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"anchor_date": anchor.Format("2006-01-02"),
		"slots":       slots,
	})
}

func (s *Server) handlePlanGetProposal(w http.ResponseWriter, r *http.Request) {
	slot := r.PathValue("slot")
	if !validProposalSlot(slot) {
		http.Error(w, `{"error":"slot must be 01-04"}`, http.StatusBadRequest)
		return
	}
	anchorS := strings.TrimSpace(r.URL.Query().Get("anchor"))
	anchor, err := parseAnchorDate(anchorS)
	if err != nil {
		http.Error(w, `{"error":"anchor query param required"}`, http.StatusBadRequest)
		return
	}
	extra := s.resolvePlanDebugOffset(r.Context(), r, nil)
	if err := s.validatePlanAnchor(anchor, extra); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
		return
	}

	key := repo.GetProposalKey(anchor, slot)
	row, err := repo.GetCfg(r.Context(), s.Pool, key)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if row.Version == 0 {
		http.Error(w, `{"error":"proposal not found"}`, http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"key":              key,
		"version":          row.Version,
		"updated_at":       row.UpdatedAt,
		"proposal":         json.RawMessage(row.Value),
		"expected_version": row.Version,
	})
}

func (s *Server) handlePlanGenerate(w http.ResponseWriter, r *http.Request) {
	if !s.auth(w, r) {
		return
	}
	var body planGenerateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid JSON body"}`, http.StatusBadRequest)
		return
	}
	slot := strings.TrimSpace(body.Slot)
	if slot == "" {
		slot = "01"
	}
	if !validProposalSlot(slot) {
		http.Error(w, `{"error":"slot must be 01-04"}`, http.StatusBadRequest)
		return
	}

	extra := s.resolvePlanDebugOffset(r.Context(), r, body.DebugDayOffset)
	out, status, msg, err := s.runScheduleSimulation(r.Context(), body.scheduleRunBody)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(msg))
		return
	}
	if err := s.validatePlanAnchor(out.Anchor, extra); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
		return
	}

	proposal := buildProposalFromSim(out, nil)
	if err := s.saveProposal(r, out.Anchor, slot, proposal, nil); err != nil {
		if errors.Is(err, repo.ErrVersionConflict) {
			http.Error(w, `{"error":"version_conflict"}`, http.StatusConflict)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":          true,
		"slot":        slot,
		"anchor_date": proposal.AnchorDate,
		"days":        proposal.Days,
		"shift_hours": proposal.ShiftHours,
		"assignments": proposal.Assignments,
		"count":       len(proposal.Assignments),
		"meta":        proposal.Meta,
		"changes":     proposal.Changes,
		"proposal":    proposal,
	})
}

func (s *Server) handlePlanPutProposal(w http.ResponseWriter, r *http.Request) {
	if !s.auth(w, r) {
		return
	}
	slot := r.PathValue("slot")
	if !validProposalSlot(slot) {
		http.Error(w, `{"error":"slot must be 01-04"}`, http.StatusBadRequest)
		return
	}
	anchorS := strings.TrimSpace(r.URL.Query().Get("anchor"))
	anchor, err := parseAnchorDate(anchorS)
	if err != nil {
		http.Error(w, `{"error":"anchor query param required"}`, http.StatusBadRequest)
		return
	}
	extra := s.resolvePlanDebugOffset(r.Context(), r, nil)
	if err := s.validatePlanAnchor(anchor, extra); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
		return
	}

	var body planPutBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if body.ExpectedVersion == nil {
		http.Error(w, `{"error":"expected_version required"}`, http.StatusBadRequest)
		return
	}
	body.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if body.FormatVersion == 0 {
		body.FormatVersion = proposalFormatVersion
	}

	if err := s.saveProposal(r, anchor, slot, body.proposalDoc, body.ExpectedVersion); err != nil {
		if errors.Is(err, repo.ErrVersionConflict) {
			http.Error(w, `{"error":"version_conflict"}`, http.StatusConflict)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	row, _ := repo.GetCfg(r.Context(), s.Pool, repo.GetProposalKey(anchor, slot))
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":       true,
		"key":      repo.GetProposalKey(anchor, slot),
		"version":  row.Version,
		"updated_at": row.UpdatedAt,
	})
}

func (s *Server) saveProposal(r *http.Request, anchor time.Time, slot string, doc proposalDoc, expectedVersion *int64) error {
	key := repo.GetProposalKey(anchor, slot)
	raw, err := json.Marshal(doc)
	if err != nil {
		return err
	}
	tx, err := s.Pool.Begin(r.Context())
	if err != nil {
		return err
	}
	defer tx.Rollback(r.Context())

	ev := expectedVersion
	if ev == nil {
		cur, err := repo.GetCfgForUpdate(r.Context(), tx, key)
		if err != nil {
			return err
		}
		v := cur.Version
		ev = &v
	}
	_, err = repo.PutCfg(r.Context(), tx, key, raw, ev)
	if err != nil {
		return err
	}
	summary, _ := json.Marshal(map[string]any{
		"anchor_date": doc.AnchorDate,
		"slot":        slot,
		"assignments": len(doc.Assignments),
	})
	if err := repo.UpsertCfg(r.Context(), tx, "last_run_summary", summary); err != nil {
		return err
	}
	return tx.Commit(r.Context())
}

func (s *Server) handlePlanDeleteProposal(w http.ResponseWriter, r *http.Request) {
	if !s.auth(w, r) {
		return
	}
	slot := r.PathValue("slot")
	if !validProposalSlot(slot) {
		http.Error(w, `{"error":"slot must be 01-04"}`, http.StatusBadRequest)
		return
	}
	anchorS := strings.TrimSpace(r.URL.Query().Get("anchor"))
	anchor, err := parseAnchorDate(anchorS)
	if err != nil {
		http.Error(w, `{"error":"anchor query param required"}`, http.StatusBadRequest)
		return
	}
	extra := s.resolvePlanDebugOffset(r.Context(), r, nil)
	if err := s.validatePlanAnchor(anchor, extra); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
		return
	}

	key := repo.GetProposalKey(anchor, slot)
	tx, err := s.Pool.Begin(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(r.Context())
	if err := repo.DeleteCfgKey(r.Context(), tx, key); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "slot": slot, "anchor_date": anchor.Format("2006-01-02")})
}

func (s *Server) handlePlanApply(w http.ResponseWriter, r *http.Request) {
	if !s.auth(w, r) {
		return
	}
	var body planApplyBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	slot := strings.TrimSpace(body.Slot)
	if !validProposalSlot(slot) {
		http.Error(w, `{"error":"slot must be 01-04"}`, http.StatusBadRequest)
		return
	}
	anchor, err := parseAnchorDate(body.AnchorDate)
	if err != nil {
		http.Error(w, `{"error":"invalid anchor_date"}`, http.StatusBadRequest)
		return
	}
	extra := s.resolvePlanDebugOffset(r.Context(), r, body.DebugDayOffset)
	if err := s.validatePlanAnchor(anchor, extra); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
		return
	}

	key := repo.GetProposalKey(anchor, slot)
	row, err := repo.GetCfg(r.Context(), s.Pool, key)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if row.Version == 0 {
		http.Error(w, `{"error":"proposal not found"}`, http.StatusNotFound)
		return
	}
	var doc proposalDoc
	if err := json.Unmarshal(row.Value, &doc); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	_, soldierKeys, slotLabels, _, err := s.loadPlanInputs(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Build records from assignments JSON (client may have edited soldier_id).
	recs := guardsched.RecordsFromAssignmentJSON(doc.Assignments, soldierKeys)
	bp, _ := guardsched.CalendarBlocksPerDaySafe(doc.ShiftHours)
	rows, err := schedule.ToScheduleRows(schedule.PersistInput{
		AnchorDate: anchor, BlockHours: doc.ShiftHours, BlocksPerDay: bp,
		SoldierKeys: soldierKeys, SlotLabels: slotLabels, Records: recs,
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	ctx := r.Context()
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	endDate := anchor.AddDate(0, 0, doc.Days-1)
	if err := repo.DeleteScheduleRange(ctx, tx, anchor, endDate); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := repo.InsertScheduleRows(ctx, tx, rows); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := repo.DeleteCfgByPrefix(ctx, tx, "proposal-"); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":          true,
		"anchor_date": doc.AnchorDate,
		"slot":        slot,
		"rows_written": len(rows),
	})
}

func intFromAny(v any) int {
	switch x := v.(type) {
	case float64:
		return int(x)
	case int:
		return x
	case json.Number:
		i, _ := x.Int64()
		return int(i)
	default:
		return 0
	}
}

func floatFromAny(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case int:
		return float64(x)
	case json.Number:
		f, _ := x.Float64()
		return f
	default:
		return 0
	}
}

func stringFromAny(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

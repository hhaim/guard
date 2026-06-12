package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"guard/guardsched"
	"guard/internal/availability"
	"guard/internal/repo"
)

func (s *Server) handleSoldiersList(w http.ResponseWriter, r *http.Request) {
	row, err := repo.GetCfg(r.Context(), s.Pool, "soldiers")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	var doc struct {
		Soldiers []struct {
			ID       string `json:"id"`
			Key      string `json:"key"`
			FullName string `json:"full_name"`
			State    string `json:"state"`
		} `json:"soldiers"`
	}
	_ = json.Unmarshal(row.Value, &doc)
	now := guardsched.NowFakeUTC()
	winStart, winEnd := availability.PlanDayBounds(now, 0, 5)
	if g, err := repo.GetCfg(r.Context(), s.Pool, "global"); err == nil && g.Version != 0 {
		if h, _, perr := globalPlanDayStartFromCfg(g.Value); perr == nil {
			winStart, winEnd = availability.PlanDayBounds(now, 0, h)
		}
	}
	entries, _ := repo.ListStatusEntriesForRange(r.Context(), s.Pool, winStart.AddDate(0, 0, -7), winEnd)
	type outRow struct {
		ID          string `json:"id"`
		FullName    string `json:"full_name"`
		CurrentStatus string `json:"current_status"`
	}
	var list []outRow
	for _, sol := range doc.Soldiers {
		id := sol.ID
		if id == "" {
			id = sol.Key
		}
		st := availability.StatusBase
		for _, e := range entries {
			if e.SoldierID != id {
				continue
			}
			if e.StartAt.After(now) {
				continue
			}
			if e.EndAt != nil && !e.EndAt.After(now) {
				continue
			}
			st = availability.NormalizeStatus(e.Status)
		}
		list = append(list, outRow{ID: id, FullName: sol.FullName, CurrentStatus: st})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"soldiers": list})
}

type statusEntryJSON struct {
	ID        *int64     `json:"id,omitempty"`
	SoldierID string     `json:"soldier_id"`
	StartAt   time.Time  `json:"start_at"`
	EndAt     *time.Time `json:"end_at"`
	Status    string     `json:"status"`
	Note      string     `json:"note,omitempty"`
	Actor     string     `json:"actor,omitempty"`
	Editable  bool       `json:"editable"`
}

func (s *Server) handleSoldiersStatusList(w http.ResponseWriter, r *http.Request) {
	fromS := strings.TrimSpace(r.URL.Query().Get("from"))
	toS := strings.TrimSpace(r.URL.Query().Get("to"))
	from, err := time.Parse(time.RFC3339, fromS)
	if err != nil {
		http.Error(w, `{"error":"from required (RFC3339)"}`, http.StatusBadRequest)
		return
	}
	to, err := time.Parse(time.RFC3339, toS)
	if err != nil {
		http.Error(w, `{"error":"to required (RFC3339)"}`, http.StatusBadRequest)
		return
	}
	soldierFilter := strings.TrimSpace(r.URL.Query().Get("soldier_id"))

	intervals, err := repo.ListStatusEntriesForRange(r.Context(), s.Pool, from, to)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	hot, err := repo.ListHotStatusEntries(r.Context(), s.Pool, from, to)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	hotByKey := make(map[string]repo.StatusEntryRow)
	for _, h := range hot {
		key := fmt.Sprintf("%s|%s|%s", h.SoldierID, h.StartAt.UTC().Format(time.RFC3339Nano), h.Status)
		hotByKey[key] = h
	}

	var out []statusEntryJSON
	for _, e := range intervals {
		if soldierFilter != "" && e.SoldierID != soldierFilter {
			continue
		}
		key := fmt.Sprintf("%s|%s|%s", e.SoldierID, e.StartAt.UTC().Format(time.RFC3339Nano), e.Status)
		row := statusEntryJSON{
			SoldierID: e.SoldierID,
			StartAt:   e.StartAt,
			EndAt:     e.EndAt,
			Status:    e.Status,
			Editable:  false,
		}
		if h, ok := hotByKey[key]; ok && h.CompactedAt == nil {
			id := h.ID
			row.ID = &id
			row.Note = h.Note
			row.Actor = h.Actor
			row.Editable = repo.HotStatusEntryEditable(h)
		}
		out = append(out, row)
	}
	// Hot rows not yet merged into intervals list (edge) — include any hot-only
	for _, h := range hot {
		if soldierFilter != "" && h.SoldierID != soldierFilter {
			continue
		}
		if h.CompactedAt != nil {
			continue
		}
		found := false
		for _, o := range out {
			if o.ID != nil && *o.ID == h.ID {
				found = true
				break
			}
		}
		if found {
			continue
		}
		id := h.ID
		out = append(out, statusEntryJSON{
			ID:        &id,
			SoldierID: h.SoldierID,
			StartAt:   h.StartAt,
			EndAt:     h.EndAt,
			Status:    h.Status,
			Note:      h.Note,
			Actor:     h.Actor,
			Editable:  repo.HotStatusEntryEditable(h),
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].SoldierID != out[j].SoldierID {
			return out[i].SoldierID < out[j].SoldierID
		}
		return out[i].StartAt.Before(out[j].StartAt)
	})
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"entries": out})
}

type statusCreateBody struct {
	SoldierID string  `json:"soldier_id"`
	StartAt   string  `json:"start_at"`
	EndAt     *string `json:"end_at"`
	Status    string  `json:"status"`
	Note      string  `json:"note"`
}

type statusClearBody struct {
	SoldierID string `json:"soldier_id"`
	StartAt   string `json:"start_at"`
	EndAt     string `json:"end_at"`
}

func (s *Server) handleSoldiersStatusClear(w http.ResponseWriter, r *http.Request) {
	if !s.auth(w, r) {
		return
	}
	var body statusClearBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
		return
	}
	winStart, err := time.Parse(time.RFC3339, body.StartAt)
	if err != nil {
		http.Error(w, `{"error":"invalid start_at"}`, http.StatusBadRequest)
		return
	}
	winEnd, err := time.Parse(time.RFC3339, body.EndAt)
	if err != nil {
		http.Error(w, `{"error":"invalid end_at"}`, http.StatusBadRequest)
		return
	}
	if err := repo.ClearStatusForWindow(r.Context(), s.Pool, body.SoldierID, winStart, winEnd); err != nil {
		if errors.Is(err, repo.ErrStatusTooOld) {
			http.Error(w, `{"error":"cannot clear: includes archived hot entry"}`, http.StatusForbidden)
			return
		}
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleSoldiersStatusCreate(w http.ResponseWriter, r *http.Request) {
	if !s.auth(w, r) {
		return
	}
	var body statusCreateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
		return
	}
	start, err := time.Parse(time.RFC3339, body.StartAt)
	if err != nil {
		http.Error(w, `{"error":"invalid start_at"}`, http.StatusBadRequest)
		return
	}
	var end *time.Time
	if body.EndAt != nil {
		t, err := time.Parse(time.RFC3339, *body.EndAt)
		if err != nil {
			http.Error(w, `{"error":"invalid end_at"}`, http.StatusBadRequest)
			return
		}
		end = &t
	}
	actor := r.Header.Get("X-Actor")
	id, err := repo.CreateStatusEntry(r.Context(), s.Pool, repo.CreateStatusEntryParams{
		SoldierID: body.SoldierID,
		StartAt:   start,
		EndAt:     end,
		Status:    body.Status,
		Note:      body.Note,
		Actor:     actor,
	})
	if err != nil {
		if errors.Is(err, repo.ErrStatusOverlaps) {
			http.Error(w, `{"error":"status interval overlaps existing entry"}`, http.StatusConflict)
			return
		}
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"id": id})
}

func (s *Server) handlePlanPreviewAvailability(w http.ResponseWriter, r *http.Request) {
	anchorS := strings.TrimSpace(r.URL.Query().Get("date"))
	anchor, err := parseAnchorDate(anchorS)
	if err != nil {
		http.Error(w, `{"error":"date query required"}`, http.StatusBadRequest)
		return
	}
	_, soldierKeys, _, _, err := s.loadPlanInputs(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	planDayStartHour := 5
	if row, err := repo.GetCfg(r.Context(), s.Pool, "global"); err == nil && row.Version != 0 {
		if h, _, perr := globalPlanDayStartFromCfg(row.Value); perr == nil {
			planDayStartHour = h
		}
	}
	_, byDay, err := s.buildPlanAvailability(r.Context(), anchor, 1, 1, planDayStartHour, soldierKeys)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	cal := anchor.Format("2006-01-02")
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(byDay[cal])
}

func (s *Server) handleSoldiersStatusPatch(w http.ResponseWriter, r *http.Request) {
	if !s.auth(w, r) {
		return
	}
	idStr := r.PathValue("id")
	startS := r.URL.Query().Get("start_at")
	var id int64
	if _, err := fmt.Sscanf(idStr, "%d", &id); err != nil {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}
	start, err := time.Parse(time.RFC3339, startS)
	if err != nil {
		http.Error(w, `{"error":"start_at query required"}`, http.StatusBadRequest)
		return
	}
	var body struct {
		EndAt *string `json:"end_at"`
		Note  string  `json:"note"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	var end *time.Time
	if body.EndAt != nil {
		t, err := time.Parse(time.RFC3339, *body.EndAt)
		if err == nil {
			end = &t
		}
	}
	if err := repo.PatchStatusEntry(r.Context(), s.Pool, id, start, end, body.Note); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		if errors.Is(err, repo.ErrStatusTooOld) {
			http.Error(w, `{"error":"entry older than 7 days cannot be edited"}`, http.StatusForbidden)
			return
		}
		if errors.Is(err, repo.ErrStatusOverlaps) {
			http.Error(w, `{"error":"status interval overlaps existing entry"}`, http.StatusConflict)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type statusImportEntryBody struct {
	SoldierID string  `json:"soldier_id"`
	StartAt   string  `json:"start_at"`
	EndAt     *string `json:"end_at"`
	Status    string  `json:"status"`
	Note      string  `json:"note"`
}

type statusImportBody struct {
	Range struct {
		From string `json:"from"`
		To   string `json:"to"`
	} `json:"range"`
	SoldierIDs []string                `json:"soldier_ids"`
	Entries    []statusImportEntryBody `json:"entries"`
}

func (s *Server) handleSoldiersStatusImport(w http.ResponseWriter, r *http.Request) {
	if !s.auth(w, r) {
		return
	}
	var body statusImportBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
		return
	}
	from, err := time.Parse(time.RFC3339, strings.TrimSpace(body.Range.From))
	if err != nil {
		http.Error(w, `{"error":"invalid range.from"}`, http.StatusBadRequest)
		return
	}
	to, err := time.Parse(time.RFC3339, strings.TrimSpace(body.Range.To))
	if err != nil {
		http.Error(w, `{"error":"invalid range.to"}`, http.StatusBadRequest)
		return
	}
	soldierIDs := body.SoldierIDs
	if len(soldierIDs) == 0 {
		seen := make(map[string]struct{})
		for _, e := range body.Entries {
			id := strings.TrimSpace(e.SoldierID)
			if id == "" {
				continue
			}
			if _, ok := seen[id]; !ok {
				seen[id] = struct{}{}
				soldierIDs = append(soldierIDs, id)
			}
		}
	}
	var entries []repo.CreateStatusEntryParams
	for _, e := range body.Entries {
		start, err := time.Parse(time.RFC3339, strings.TrimSpace(e.StartAt))
		if err != nil {
			http.Error(w, `{"error":"invalid entry start_at"}`, http.StatusBadRequest)
			return
		}
		var end *time.Time
		if e.EndAt != nil && strings.TrimSpace(*e.EndAt) != "" {
			t, err := time.Parse(time.RFC3339, strings.TrimSpace(*e.EndAt))
			if err != nil {
				http.Error(w, `{"error":"invalid entry end_at"}`, http.StatusBadRequest)
				return
			}
			end = &t
		}
		st := availability.NormalizeStatus(e.Status)
		if !availability.IsBlockingStatus(st) {
			continue
		}
		entries = append(entries, repo.CreateStatusEntryParams{
			SoldierID: strings.TrimSpace(e.SoldierID),
			StartAt:   start,
			EndAt:     end,
			Status:    st,
			Note:      strings.TrimSpace(e.Note),
		})
	}
	actor := r.Header.Get("X-Actor")
	for i := range entries {
		entries[i].Actor = actor
	}
	if err := repo.ImportSoldierStatus(r.Context(), s.Pool, from, to, soldierIDs, entries); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":%q}`, err.Error()), http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleSoldiersStatusDelete(w http.ResponseWriter, r *http.Request) {
	if !s.auth(w, r) {
		return
	}
	idStr := r.PathValue("id")
	startS := r.URL.Query().Get("start_at")
	var id int64
	if _, err := fmt.Sscanf(idStr, "%d", &id); err != nil {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}
	start, err := time.Parse(time.RFC3339, startS)
	if err != nil {
		http.Error(w, `{"error":"start_at query required"}`, http.StatusBadRequest)
		return
	}
	actor := r.Header.Get("X-Actor")
	if err := repo.DeleteHotStatusEntry(r.Context(), s.Pool, id, start, actor); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		if errors.Is(err, repo.ErrStatusTooOld) {
			http.Error(w, `{"error":"entry older than 7 days cannot be deleted"}`, http.StatusForbidden)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

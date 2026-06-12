package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"guard/guardsched"
)

func TestClassifySimulationError_RestConstraint(t *testing.T) {
	err := errors.New("guardsched: rest constraint: full_day cannot fill day 1 slot 2: no candidates")
	code, headline, hints, details := classifySimulationError(err)
	if code != "rest_constraint" {
		t.Fatalf("code=%q", code)
	}
	if headline == "" || len(hints) == 0 {
		t.Fatalf("headline/hints empty: %q %v", headline, hints)
	}
	if details["day"] != 1 || details["slot"] != 2 {
		t.Fatalf("details=%v", details)
	}
	if details["pattern"] != "full_day" {
		t.Fatalf("pattern=%v", details["pattern"])
	}
}

func TestClassifySimulationError_HistoryShiftMismatch(t *testing.T) {
	err := errors.New("verified schedule on 2026-01-01 has shift_hours=2, expected 4")
	code, _, _, _ := classifySimulationError(err)
	if code != "history_shift_mismatch" {
		t.Fatalf("code=%q", code)
	}
}

func TestClassifySimulationError_BootstrapTrials(t *testing.T) {
	err := errors.New("history without continuation requires sim_trials 1")
	code, _, _, _ := classifySimulationError(err)
	if code != "history_bootstrap_trials" {
		t.Fatalf("code=%q", code)
	}
}

func TestPlanAnchorMismatchJSON(t *testing.T) {
	s := &Server{}
	want := s.allowedPlanAnchor(0).Format("2006-01-02")
	body := planAnchorMismatch(errors.New("anchor_date must be "+want), want, map[string]any{"anchor_date": "2000-01-01"})
	if body.Code != "anchor_mismatch" {
		t.Fatalf("code=%q", body.Code)
	}
	rec := httptest.NewRecorder()
	writeAPIError(rec, body)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d", rec.Code)
	}
	if !strings.Contains(rec.Header().Get("Content-Type"), "application/json") {
		t.Fatal("expected json content type")
	}
	var parsed map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed["code"] != "anchor_mismatch" {
		t.Fatalf("parsed=%v", parsed)
	}
	if _, ok := parsed["hints"].([]any); !ok {
		t.Fatalf("hints missing: %v", parsed["hints"])
	}
}

func TestClassifySimulationError_FullDayTeam(t *testing.T) {
	err := errors.New("full_day_team: need 1 type A, have 0 available on day 1 slot 9")
	code, headline, hints, details := classifySimulationError(err)
	if code != "type_quota_unfilled" {
		t.Fatalf("code=%q", code)
	}
	if headline == "" || len(hints) == 0 {
		t.Fatal("expected headline and hints")
	}
	if details["day"] != 1 || details["slot"] != 9 || details["type_code"] != "A" {
		t.Fatalf("details=%v", details)
	}
}

func TestSimFailureEnvelope(t *testing.T) {
	err := errors.Join(guardsched.ErrRestConstraint, errors.New("full_day cannot fill day 3 slot 1"))
	code, headline, hints, details := classifySimulationError(err)
	if code != "rest_constraint" {
		t.Fatalf("code=%q", code)
	}
	if details["day"] != 3 {
		t.Fatalf("details=%v", details)
	}
	_ = headline
	_ = hints
}

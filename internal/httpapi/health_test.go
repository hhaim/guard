package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"guard/internal/auth"
)

func TestHandleHealth_MinimalBody(t *testing.T) {
	s := &Server{
		Auth: &auth.Service{
			AuthorizedParties: []string{"https://guard-scheduler.fly.dev", "http://localhost:8080"},
		},
	}
	mux := http.NewServeMux()
	s.Register(mux)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out) != 1 {
		t.Fatalf("expected single field, got %v", out)
	}
	if out["status"] != "ok" {
		t.Fatalf("status=%v", out["status"])
	}
}

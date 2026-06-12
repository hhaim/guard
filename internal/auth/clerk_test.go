package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAllowWithoutRole(t *testing.T) {
	if !allowWithoutRole(http.MethodGet, "/api/me") {
		t.Fatal("GET /api/me should be allowed without role")
	}
	if !allowWithoutRole(http.MethodGet, "/api/auth/debug") {
		t.Fatal("GET /api/auth/debug should be allowed without role")
	}
	if allowWithoutRole(http.MethodGet, "/api/cfg/slots") {
		t.Fatal("other routes must require a role")
	}
}

func TestMiddleware_skipsClerkForHealth(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	h := (&Service{}).Middleware(next)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /health: got status %d, want 200", rec.Code)
	}
}

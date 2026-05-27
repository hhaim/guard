package auth

import (
	"net/http"
	"strings"
)

// Authorize returns whether the role may access method+path.
func Authorize(role, method, path string) bool {
	if role == "admin" {
		return true
	}
	if role != "readonly" {
		return false
	}
	m := strings.ToUpper(method)
	if m != http.MethodGet && m != http.MethodHead {
		return false
	}
	switch {
	case path == "/api/me":
		return true
	case strings.HasPrefix(path, "/api/plan/"):
		return true
	case strings.HasPrefix(path, "/api/reports/"):
		return true
	case path == "/api/cfg/soldiers", path == "/api/cfg/soldier_types", path == "/api/cfg/slots":
		return true
	case strings.HasPrefix(path, "/api/soldiers/status"):
		return true
	default:
		return false
	}
}

// RequireAdminRoute is true for admin-only API prefixes.
func RequireAdminRoute(path string) bool {
	return strings.HasPrefix(path, "/api/admin/")
}

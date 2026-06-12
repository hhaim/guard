package middleware

import (
	"net/http"
	"os"
	"strings"
)

const contentSecurityPolicy = "default-src 'self'; " +
	"script-src 'self' https://*.clerk.accounts.dev https://*.clerk.com https://challenges.cloudflare.com; " +
	"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
	"font-src 'self' https://fonts.gstatic.com; " +
	"img-src 'self' data: https://*.clerk.com https://img.clerk.com; " +
	"connect-src 'self' https://*.clerk.accounts.dev https://*.clerk.com; " +
	"frame-src https://*.clerk.accounts.dev https://*.clerk.com https://challenges.cloudflare.com; " +
	"frame-ancestors 'none'; base-uri 'self'; object-src 'none'"

// SecurityHeaders adds standard HTTP security headers to every response.
func SecurityHeaders(next http.Handler) http.Handler {
	reportOnly := envTruthy("CSP_REPORT_ONLY")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
		if requestIsHTTPS(r) {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		if reportOnly {
			w.Header().Set("Content-Security-Policy-Report-Only", contentSecurityPolicy)
		} else {
			w.Header().Set("Content-Security-Policy", contentSecurityPolicy)
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(w, r)
	})
}

func requestIsHTTPS(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	return strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

func envTruthy(key string) bool {
	v := strings.TrimSpace(os.Getenv(key))
	return v == "1" || strings.EqualFold(v, "true")
}

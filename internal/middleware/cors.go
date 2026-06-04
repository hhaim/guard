package middleware

import (
	"log"
	"net/http"
	"strings"
)

// CORS applies Access-Control headers only for /api/* routes.
func CORS(next http.Handler, origin string) http.Handler {
	origin = strings.TrimSpace(origin)
	if origin == "" {
		log.Print("cors: CORS_ORIGIN unset; cross-origin /api/* calls will not receive CORS headers")
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, PUT, POST, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-API-Key, Authorization")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

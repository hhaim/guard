package auth

import (
	"net/http"
	"net/url"
	"os"
	"strings"

	clerkhttp "github.com/clerk/clerk-sdk-go/v2/http"
	"github.com/clerk/clerk-sdk-go/v2/jwt"
)

// ParseAuthorizedParties builds allowed azp (authorized party) values for JWT verification.
// Includes CORS_ORIGIN, CLERK_AUTHORIZED_PARTIES (comma-separated), and common local dev URLs.
func ParseAuthorizedParties(corsOrigin string) []string {
	seen := map[string]struct{}{}
	var out []string
	add := func(s string) {
		s = strings.TrimSpace(s)
		if s == "" {
			return
		}
		if _, ok := seen[s]; ok {
			return
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	for _, p := range strings.Split(os.Getenv("CLERK_AUTHORIZED_PARTIES"), ",") {
		add(p)
	}
	add(corsOrigin)
	if includeDevOrigins(corsOrigin) {
		for _, d := range []string{
			"http://localhost:8080",
			"http://127.0.0.1:8080",
			"http://localhost:5173",
			"http://127.0.0.1:5173",
		} {
			add(d)
		}
	}
	return out
}

func includeDevOrigins(corsOrigin string) bool {
	if strings.TrimSpace(os.Getenv("CLERK_DEV_ORIGINS")) == "0" {
		return false
	}
	corsOrigin = strings.TrimSpace(corsOrigin)
	if corsOrigin == "" {
		return true
	}
	u, err := url.Parse(corsOrigin)
	if err != nil || u.Host == "" {
		return true
	}
	host := strings.ToLower(u.Hostname())
	if host == "localhost" || host == "127.0.0.1" {
		return true
	}
	return !strings.EqualFold(u.Scheme, "https")
}

func authorizedPartyMatcher(parties []string) jwt.AuthorizedPartyHandler {
	allowed := make(map[string]struct{}, len(parties))
	for _, p := range parties {
		allowed[p] = struct{}{}
	}
	return func(azp string) bool {
		if azp == "" || len(allowed) == 0 {
			return true
		}
		_, ok := allowed[azp]
		return ok
	}
}

func bearerToken(r *http.Request) string {
	const prefix = "Bearer "
	h := strings.TrimSpace(r.Header.Get("Authorization"))
	if !strings.HasPrefix(h, prefix) {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(h, prefix))
}

func (s *Service) clerkMiddlewareOpts() []clerkhttp.AuthorizationOption {
	var opts []clerkhttp.AuthorizationOption
	if len(s.AuthorizedParties) > 0 {
		opts = append(opts, clerkhttp.AuthorizedPartyMatches(s.AuthorizedParties...))
	}
	opts = append(opts, clerkhttp.AuthorizationFailureHandler(s.jwtFailureHandler()))
	return opts
}

func (s *Service) jwtFailureHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		dbg := map[string]any{
			"hint": "Use the secret key from the same Clerk application as VITE_CLERK_PUBLISHABLE_KEY (Dashboard → API keys). Quote .env values that contain $.",
		}
		if len(s.AuthorizedParties) > 0 {
			dbg["authorized_parties"] = s.AuthorizedParties
		}
		token := bearerToken(r)
		if token == "" {
			writeJSONError(w, http.StatusUnauthorized, "missing bearer token", dbg)
			return
		}
		if s.Debug {
			if _, err := jwt.Decode(r.Context(), &jwt.DecodeParams{Token: token}); err != nil {
				dbg["jwt_decode_error"] = err.Error()
			} else {
				vp := &jwt.VerifyParams{Token: token}
				if len(s.AuthorizedParties) > 0 {
					vp.AuthorizedPartyHandler = authorizedPartyMatcher(s.AuthorizedParties)
				}
				if _, err := jwt.Verify(r.Context(), vp); err != nil {
					dbg["jwt_verify_error"] = err.Error()
				}
			}
		}
		s.logAuth("reject", map[string]any{"step": "jwt_verify_failed", "path": r.URL.Path, "debug": dbg})
		writeJSONError(w, http.StatusUnauthorized, "invalid session token", dbg)
	})
}

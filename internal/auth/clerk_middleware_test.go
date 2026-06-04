package auth

import (
	"slices"
	"testing"
)

func TestParseAuthorizedParties_ProductionSkipsDev(t *testing.T) {
	t.Setenv("CLERK_AUTHORIZED_PARTIES", "")
	t.Setenv("CLERK_DEV_ORIGINS", "")

	parties := ParseAuthorizedParties("https://guard-scheduler.fly.dev")
	for _, dev := range []string{
		"http://localhost:8080",
		"http://127.0.0.1:8080",
		"http://localhost:5173",
		"http://127.0.0.1:5173",
	} {
		if slices.Contains(parties, dev) {
			t.Fatalf("production parties should not include %q: %v", dev, parties)
		}
	}
	if !slices.Contains(parties, "https://guard-scheduler.fly.dev") {
		t.Fatalf("missing production origin: %v", parties)
	}
}

func TestParseAuthorizedParties_LocalIncludesDev(t *testing.T) {
	t.Setenv("CLERK_AUTHORIZED_PARTIES", "")
	t.Setenv("CLERK_DEV_ORIGINS", "")

	parties := ParseAuthorizedParties("http://localhost:8080")
	if !slices.Contains(parties, "http://localhost:5173") {
		t.Fatalf("local dev should include vite origin: %v", parties)
	}
}

func TestParseAuthorizedParties_ExplicitDisable(t *testing.T) {
	t.Setenv("CLERK_AUTHORIZED_PARTIES", "")
	t.Setenv("CLERK_DEV_ORIGINS", "0")

	parties := ParseAuthorizedParties("http://localhost:8080")
	if slices.Contains(parties, "http://localhost:5173") {
		t.Fatalf("CLERK_DEV_ORIGINS=0 should disable dev origins: %v", parties)
	}
}

func TestParseAuthorizedParties_ExtraParties(t *testing.T) {
	t.Setenv("CLERK_AUTHORIZED_PARTIES", "https://staging.example.com")
	t.Setenv("CLERK_DEV_ORIGINS", "0")

	parties := ParseAuthorizedParties("https://guard-scheduler.fly.dev")
	if !slices.Contains(parties, "https://staging.example.com") {
		t.Fatalf("missing CLERK_AUTHORIZED_PARTIES entry: %v", parties)
	}
}

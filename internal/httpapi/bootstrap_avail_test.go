package httpapi

import (
	"os"
	"testing"
	"time"

	"guard/guardsched"
	"guard/internal/availability"
)

// Reproduces type_quota_unfilled on bootstrap day 2 when availability is scoped to planDays only.
func TestBootstrapColdFailsWhenAvailabilityScopedToPlanDaysOnly(t *testing.T) {
	root := findRepoRoot(t)
	zonesRaw, err := os.ReadFile(root + "/zones-example.yaml")
	if err != nil {
		t.Skip("zones-example.yaml missing")
	}
	rosterRaw, err := os.ReadFile(root + "/roster-example.yaml")
	if err != nil {
		t.Skip("roster-example.yaml missing")
	}
	zc, err := guardsched.LoadZoneConfigYAML(zonesRaw, 10, nil)
	if err != nil {
		t.Fatal(err)
	}
	keys, err := guardsched.LoadRosterSoldierIDsYAML(rosterRaw)
	if err != nil {
		t.Fatal(err)
	}
	typeCodes, err := guardsched.LoadRosterTypeCodesYAML(rosterRaw, keys)
	if err != nil {
		t.Fatal(err)
	}
	platoonCodes, err := guardsched.LoadRosterPlatoonCodesYAML(rosterRaw, keys)
	if err != nil {
		t.Fatal(err)
	}
	anchor := time.Date(2026, 6, 8, 0, 0, 0, 0, time.UTC)
	const prefixDays = 14
	const planDays = 1
	seed := int64(0)

	planOnlyAvail := availability.NewChecker(anchor, 5, keys, nil, planDays)
	rng := guardsched.NewPyRandom(seed)
	_, err = guardsched.RunSimulationZoneConfigWithContinuation(
		zc, len(keys), prefixDays+planDays, prefixDays, rng,
		6, true, 0, 2, 2, 0.2,
		5, planOnlyAvail, &anchor, typeCodes, platoonCodes, &seed, nil,
	)
	if err == nil {
		t.Fatal("expected bootstrap cold to fail when availability covers planDays only")
	}
	if got := err.Error(); !containsAll(got, "day 2", "slot 8", "type E") {
		t.Fatalf("unexpected error: %v", err)
	}

	fullAvail := availability.NewChecker(anchor, 5, keys, nil, prefixDays+planDays)
	rng2 := guardsched.NewPyRandom(seed)
	_, err = guardsched.RunSimulationZoneConfigWithContinuation(
		zc, len(keys), prefixDays+planDays, prefixDays, rng2,
		6, true, 0, 2, 2, 0.2,
		5, fullAvail, &anchor, typeCodes, platoonCodes, &seed, nil,
	)
	if err != nil {
		t.Fatalf("bootstrap cold should succeed with full-horizon availability: %v", err)
	}
}

func findRepoRoot(t *testing.T) string {
	t.Helper()
	return "../.."
}

func containsAll(s string, parts ...string) bool {
	for _, p := range parts {
		if !contains(s, p) {
			return false
		}
	}
	return true
}

func contains(s, sub string) bool {
	return len(sub) == 0 || (len(s) >= len(sub) && indexOf(s, sub) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

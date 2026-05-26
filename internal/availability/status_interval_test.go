package availability

import (
	"testing"
	"time"
)

func TestEntriesOverlap(t *testing.T) {
	t0 := time.Date(2026, 5, 1, 10, 0, 0, 0, time.UTC)
	t1 := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	t2 := time.Date(2026, 5, 1, 11, 0, 0, 0, time.UTC)
	t3 := time.Date(2026, 5, 1, 13, 0, 0, 0, time.UTC)

	if !EntriesOverlap(t0, &t1, t2, &t3) {
		t.Fatal("expected overlap")
	}
	if EntriesOverlap(t0, &t1, t1, &t3) {
		t.Fatal("touching end/start should not overlap")
	}
	var nilEnd *time.Time
	if !EntriesOverlap(t0, nilEnd, t2, nilEnd) {
		t.Fatal("two open intervals should overlap")
	}
}

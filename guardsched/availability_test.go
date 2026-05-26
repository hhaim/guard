package guardsched

import (
	"fmt"
	"testing"
	"time"

	"guard/internal/availability"
)

func TestPartialReturnMorningBlockUnavailable(t *testing.T) {
	anchor := time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)
	roster := make([]string, 12)
	for i := range roster {
		roster[i] = fmt.Sprintf("s%d", i)
	}
	entries := []availability.Entry{
		{
			SoldierID: "s2",
		 StartAt:   anchor.AddDate(0, 0, -1).Add(5 * time.Hour),
			EndAt:     ptrT(anchor.Add(12 * time.Hour)),
			Status:    availability.StatusAway,
		},
	}
	chk := availability.NewChecker(anchor, 5, roster, entries, 1)
	if chk.AvailRotatingBlock(2, 0, 0, 5, 4) {
		t.Fatal("s2 should be unavailable for block 0 (05:00-09:00) while away until 12:00")
	}
	if !chk.AvailRotatingBlock(2, 0, 2, 5, 4) {
		t.Fatal("s2 should be available for block 2 (13:00-17:00) after return")
	}
}

func ptrT(t time.Time) *time.Time { return &t }

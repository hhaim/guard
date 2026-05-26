package availability

import (
	"fmt"
	"testing"
	"time"
)

func TestCompileDayAvailability_partialReturn(t *testing.T) {
	anchor := time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)
	roster := []string{"s0", "s13"}
	entries := []Entry{
		{
			SoldierID: "s13",
			StartAt: anchor.AddDate(0, 0, -1).Add(5 * time.Hour),
			EndAt:   ptrTime(anchor.Add(12 * time.Hour)),
			Status:  StatusAway,
		},
	}
	day := CompileDayAvailability(anchor, 0, 5, roster, entries)
	if len(day.AvailFull) != 1 || day.AvailFull[0] != "s0" {
		t.Fatalf("avail_full: %+v", day.AvailFull)
	}
	p, ok := day.AvailPartial["s13"]
	if !ok || len(p) != 1 {
		t.Fatalf("avail_partial s13: %+v", day.AvailPartial)
	}
	if p[0][0] != "12:00" {
		t.Fatalf("partial start want 12:00 got %s", p[0][0])
	}
}

func TestCompileDayAvailability_absentList(t *testing.T) {
	anchor := time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)
	roster := []string{"s0", "s3"}
	entries := []Entry{
		{
			SoldierID: "s3",
			StartAt: anchor.AddDate(0, 0, -1).Add(5 * time.Hour),
			EndAt:   nil,
			Status:  StatusSick,
		},
	}
	day := CompileDayAvailability(anchor, 0, 5, roster, entries)
	if len(day.AvailAbsent) != 1 || day.AvailAbsent[0] != "s3" {
		t.Fatalf("avail_absent: %+v", day.AvailAbsent)
	}
	if day.Summary.AbsentFull != 1 {
		t.Fatalf("summary absent_full: %+v", day.Summary)
	}
}

func TestChecker_availRotatingNightBlocks(t *testing.T) {
	anchor := time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)
	roster := make([]string, 12)
	for i := range roster {
		roster[i] = fmt.Sprintf("s%d", i)
	}
	entries := []Entry{
		{
			SoldierID: "s2",
			StartAt: anchor.AddDate(0, 0, -1).Add(5 * time.Hour),
			EndAt:   ptrTime(anchor.Add(12 * time.Hour)),
			Status:  StatusAway,
		},
	}
	chk := NewChecker(anchor, 5, roster, entries, 1)
	for _, block := range []int{4, 5} {
		if !chk.AvailRotatingBlock(2, 0, block, 5, 4) {
			t.Fatalf("s2 should be available for evening/night block %d", block)
		}
		if !chk.AvailRotatingBlock(0, 0, block, 5, 4) {
			t.Fatalf("s0 should be available for block %d", block)
		}
	}
	if chk.AvailRotatingBlock(2, 0, 0, 5, 4) {
		t.Fatal("s2 should be blocked for morning block 0")
	}
}

func TestChecker_availRotatingSubset(t *testing.T) {
	anchor := time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)
	roster := []string{"s15"}
	// Outing 20:00–01:00 on plan day starting 05:00
	entries := []Entry{
		{
			SoldierID: "s15",
			StartAt: anchor.Add(20 * time.Hour),
			EndAt:   ptrTime(anchor.AddDate(0, 0, 1).Add(1 * time.Hour)),
			Status:  StatusOuting,
		},
	}
	chk := NewChecker(anchor, 5, roster, entries, 1)
	if !chk.AvailDutyWallHours(0, 0, 10, 12) {
		t.Fatal("expected morning assignable")
	}
	if chk.AvailDutyWallHours(0, 0, 20, 22) {
		t.Fatal("expected outing blocked")
	}
}

func ptrTime(t time.Time) *time.Time { return &t }

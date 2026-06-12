package guardsched

import (
	"testing"
	"time"
)

func TestParsePlanDayStart(t *testing.T) {
	h, err := ParsePlanDayStart("05:00")
	if err != nil || h != 5 {
		t.Fatalf("05:00: got %d err %v", h, err)
	}
	if _, err := ParsePlanDayStart("05:30"); err == nil {
		t.Fatal("expected error for non-zero minutes")
	}
	if _, err := ParsePlanDayStart("bad"); err == nil {
		t.Fatal("expected error for bad input")
	}
	empty, err := ParsePlanDayStart("")
	if err != nil || empty != 5 {
		t.Fatalf("empty default: %d %v", empty, err)
	}
}

func TestWeekdayAtPlanDayStart(t *testing.T) {
	// 2026-05-29 UTC is Friday; plan day 0 begins Fri 05:00, plan day 1 begins Sat 05:00.
	anchor := time.Date(2026, 5, 29, 0, 0, 0, 0, time.UTC)
	if got := WeekdayAtPlanDayStart(anchor, 0, 5); got != 5 {
		t.Fatalf("plan day 0 @05:00: got %d want Friday(5)", got)
	}
	if got := WeekdayAtPlanDayStart(anchor, 1, 5); got != 6 {
		t.Fatalf("plan day 1 @05:00: got %d want Saturday(6)", got)
	}
	// Midnight-only helper matches calendar date + offset.
	if WeekdayForAnchorPlanDay(anchor, 0) != 5 {
		t.Fatalf("midnight plan day 0: got %d want Friday(5)", WeekdayForAnchorPlanDay(anchor, 0))
	}
}

func TestBlockStartHour(t *testing.T) {
	if got := BlockStartHour(5, 0, 4); got != 5 {
		t.Fatalf("block 0: got %d want 5", got)
	}
	if got := BlockStartHour(5, 5, 4); got != 1 {
		t.Fatalf("block 5: got %d want 1", got)
	}
}

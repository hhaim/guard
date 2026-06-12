package guardsched

import (
	"testing"
	"time"
)

func TestNowFakeUTCUsesUTCLocation(t *testing.T) {
	n := NowFakeUTC()
	if n.Location() != time.UTC {
		t.Fatalf("location = %v, want UTC", n.Location())
	}
	if n.IsZero() {
		t.Fatal("expected non-zero time")
	}
}

func TestTodayFakeUTCTruncatesToMidnight(t *testing.T) {
	today := TodayFakeUTC()
	if today.Hour() != 0 || today.Minute() != 0 || today.Second() != 0 || today.Nanosecond() != 0 {
		t.Fatalf("expected midnight, got %v", today)
	}
	if today.Location() != time.UTC {
		t.Fatalf("location = %v, want UTC", today.Location())
	}
	n := NowFakeUTC()
	if today.Year() != n.Year() || today.Month() != n.Month() || today.Day() != n.Day() {
		t.Fatalf("TodayFakeUTC date %v != NowFakeUTC date %v", today.Format("2006-01-02"), n.Format("2006-01-02"))
	}
}

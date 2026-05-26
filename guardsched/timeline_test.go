package guardsched

import (
	"fmt"
	"testing"
	"time"

	"guard/internal/availability"
)

type stubAvail struct {
	blocked map[string]struct{}
}

func (s *stubAvail) AvailIdx(idx, day int, dutyStart, dutyEnd time.Time) bool {
	_, ok := s.blocked[key(idx, day)]
	return !ok
}

func (s *stubAvail) AvailDutyWallHours(idx, day, h0, h1 int) bool {
	_, ok := s.blocked[key(idx, day)]
	return !ok
}

func (s *stubAvail) AvailRotatingBlock(idx, day, block int, planDayStartHour int, shiftHours float64) bool {
	_, ok := s.blocked[key(idx, day)]
	return !ok
}

func key(idx, day int) string {
	return fmt.Sprintf("%d:%d", idx, day)
}

func TestBuildUnavailTimelineTensor(t *testing.T) {
	st := &stubAvail{blocked: map[string]struct{}{"1:0": {}}}
	u := BuildUnavailTimelineTensor(st, 1, 2, 3, 5, 4)
	if u == nil || len(u) != 1 || len(u[0]) != 2 || len(u[0][1]) != 3 {
		t.Fatalf("shape: %+v", u)
	}
	if !u[0][1][0] || !u[0][1][1] || !u[0][1][2] {
		t.Fatalf("soldier 1 day 0 should be blocked: %+v", u[0][1])
	}
	if u[0][0][0] {
		t.Fatal("soldier 0 should be available")
	}
}

func TestBuildUnavailTimelineTensor_nilChecker(t *testing.T) {
	if BuildUnavailTimelineTensor(nil, 1, 1, 1, 5, 4) != nil {
		t.Fatal("nil checker should return nil tensor")
	}
}

func TestBuildUnavailTimelineTensor_integration(t *testing.T) {
	anchor := time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)
	roster := []string{"s0", "s1"}
	entries := []availability.Entry{
		{
			SoldierID: "s1",
			StartAt: anchor.AddDate(0, 0, -1).Add(5 * time.Hour),
			EndAt:   nil,
			Status:  availability.StatusSick,
		},
	}
	chk := availability.NewChecker(anchor, 5, roster, entries, 1)
	u := BuildUnavailTimelineTensor(chk, 1, 2, 6, 5, 4)
	if u == nil {
		t.Fatal("expected tensor")
	}
	for b := 0; b < 6; b++ {
		if !u[0][1][b] {
			t.Fatalf("s1 sick all day: block %d should be unavail", b)
		}
	}
	for b := 0; b < 6; b++ {
		if u[0][0][b] {
			t.Fatalf("s0 should be avail block %d", b)
		}
	}
}

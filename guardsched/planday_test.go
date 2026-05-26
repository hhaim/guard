package guardsched

import "testing"

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

func TestBlockStartHour(t *testing.T) {
	if got := BlockStartHour(5, 0, 4); got != 5 {
		t.Fatalf("block 0: got %d want 5", got)
	}
	if got := BlockStartHour(5, 5, 4); got != 1 {
		t.Fatalf("block 5: got %d want 1", got)
	}
}

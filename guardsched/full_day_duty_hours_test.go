package guardsched

import "testing"

func TestForEachFullDayDutyHour_sameClockIs24Hours(t *testing.T) {
	var hours []int
	forEachFullDayDutyHour(9, 9, func(h int) { hours = append(hours, h) })
	if len(hours) != 24 {
		t.Fatalf("got %d hours want 24: %v", len(hours), hours)
	}
}

func TestForEachFullDayDutyHour_inclusiveRange(t *testing.T) {
	var hours []int
	forEachFullDayDutyHour(6, 22, func(h int) { hours = append(hours, h) })
	if len(hours) != 17 {
		t.Fatalf("got %d hours want 17", len(hours))
	}
}

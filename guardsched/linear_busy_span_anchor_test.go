package guardsched

import "testing"

func TestLinearBusySpanCalendarBlock_fullDay0909(t *testing.T) {
	B := 6
	day := 0
	L0, span := linearBusySpanDutyHoursPlusRest(day, B, 4, 9, 9, false, 4, 5)
	spanB0 := LinearBusySpanCalendarBlock(day, B, L0)
	if spanB0 != 1 {
		t.Fatalf("spanB0=%d want 1 (09:00 block)", spanB0)
	}
	if span != 7 {
		t.Fatalf("span=%d want 7", span)
	}
}

func TestLinearBusySpanCalendarBlock_team0522(t *testing.T) {
	B := 6
	day := 0
	L0, span := linearBusySpanDutyHoursPlusRest(day, B, 4, 5, 22, false, 6, 5)
	spanB0 := LinearBusySpanCalendarBlock(day, B, L0)
	if spanB0 != 0 {
		t.Fatalf("spanB0=%d want 0 (05:00 block)", spanB0)
	}
	if span != 6 {
		t.Fatalf("span=%d want 6", span)
	}
}

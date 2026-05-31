package guardsched

import "testing"

func TestDutyBlocksPlanAligned_09To09_planStart5(t *testing.T) {
	b0, b1 := dutyBlocksPlanAligned(4, 9, 9, 5, 6)
	if b0 != 1 || b1 != 5 {
		t.Fatalf("dutyBlocksPlanAligned(09–09) = (%d,%d) want (1,5)", b0, b1)
	}
}

func TestDutyBlocksPlanAligned_08To16_planStart5(t *testing.T) {
	b0, b1 := dutyBlocksPlanAligned(4, 8, 16, 5, 6)
	if b0 != 0 || b1 != 2 {
		t.Fatalf("dutyBlocksPlanAligned(08–16) = (%d,%d) want (0,2)", b0, b1)
	}
}

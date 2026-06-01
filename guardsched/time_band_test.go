package guardsched

import "testing"

func TestParseTimeBandBound(t *testing.T) {
	m, err := parseTimeBandBound(0)
	if err != nil || m != 0 {
		t.Fatalf("int 0: got %d err=%v", m, err)
	}
	m, err = parseTimeBandBound("06:00")
	if err != nil || m != 360 {
		t.Fatalf(`"06:00": got %d err=%v`, m, err)
	}
	m, err = parseTimeBandBound("24:00")
	if err != nil || m != 1440 {
		t.Fatalf(`"24:00": got %d err=%v`, m, err)
	}
	m, err = parseTimeBandBound(24)
	if err != nil || m != 1440 {
		t.Fatalf("int 24: got %d err=%v", m, err)
	}
	m, err = parseTimeBandBound(1320)
	if err != nil || m != 1320 {
		t.Fatalf("sexagesimal 1320 (22:00): got %d err=%v", m, err)
	}
	m, err = parseTimeBandBound(1020)
	if err != nil || m != 1020 {
		t.Fatalf("sexagesimal 1020 (17:00): got %d err=%v", m, err)
	}
}

func TestParseClockHour_sexagesimal(t *testing.T) {
	h, err := parseClockHour(1320)
	if err != nil || h != 22 {
		t.Fatalf("1320: got %d err=%v", h, err)
	}
	h, err = parseClockHour(540)
	if err != nil || h != 9 {
		t.Fatalf("540: got %d err=%v", h, err)
	}
	lo, hi, err := parseInclusiveFullDayHours(360, 1320)
	if err != nil || lo != 6 || hi != 22 {
		t.Fatalf("full_day sexagesimal: got (%d,%d) err=%v", lo, hi, err)
	}
}

func TestTimeBandContainsStartMin_normal(t *testing.T) {
	from, to := 0, 360 // [00:00, 06:00)
	for h := 0; h <= 5; h++ {
		if !timeBandContainsStartMin(from, to, h*60) {
			t.Fatalf("hour %d should match night band", h)
		}
	}
	if timeBandContainsStartMin(from, to, 6*60) {
		t.Fatal("hour 6 should not match [0,6)")
	}
}

func TestTimeBandContainsStartMin_wrap(t *testing.T) {
	from, to := 21*60, 60 // [21:00, 01:00)
	for _, h := range []int{21, 22, 23, 0} {
		if !timeBandContainsStartMin(from, to, h*60) {
			t.Fatalf("hour %d should match wrap band", h)
		}
	}
	for _, h := range []int{1, 20} {
		if timeBandContainsStartMin(from, to, h*60) {
			t.Fatalf("hour %d should not match wrap band", h)
		}
	}
}

func TestTimeBandSpanHours(t *testing.T) {
	if timeBandSpanHours(0, 360) != 6 {
		t.Fatalf("night span got %v", timeBandSpanHours(0, 360))
	}
	if timeBandSpanHours(21*60, 60) != 4 {
		t.Fatalf("wrap span got %v", timeBandSpanHours(21*60, 60))
	}
	if timeBandSpanHours(12*60, 1440) != 12 {
		t.Fatalf("day span got %v", timeBandSpanHours(12*60, 1440))
	}
}

func TestFullDay0909_SixShiftAlignedBands(t *testing.T) {
	// full_day 09:00–09:00 visits each wall hour once; six 4h half-open bands tile the day.
	z := &Zone{
		TimeFromMin:   []int{5 * 60, 9 * 60, 13 * 60, 17 * 60, 21 * 60, 60},
		TimeToExclMin: []int{9 * 60, 13 * 60, 17 * 60, 21 * 60, 60, 5 * 60},
		TimeWeights:   []float64{1, 1, 1, 1, 1, 1},
	}
	var hours []int
	for h := 9; h < 24; h++ {
		hours = append(hours, h)
	}
	for h := 0; h < 9; h++ {
		hours = append(hours, h)
	}
	counts := make([]int, 6)
	for _, h := range hours {
		counts[timeCategoryForHour(h, z)]++
	}
	for j, c := range counts {
		if c != 4 {
			t.Fatalf("band %d credited %d duty hours, want 4", j, c)
		}
	}
}

func TestTimeCategoryForHour_halfOpen(t *testing.T) {
	z := &Zone{
		TimeFromMin:    []int{0, 360, 720},
		TimeToExclMin:  []int{360, 720, 1440},
		TimeWeights:    []float64{1, 1, 1},
	}
	if timeCategoryForHour(5, z) != 0 {
		t.Fatalf("hour 5 want band 0")
	}
	if timeCategoryForHour(6, z) != 1 {
		t.Fatalf("hour 6 want band 1")
	}
	if timeCategoryForHour(23, z) != 2 {
		t.Fatalf("hour 23 want band 2")
	}
}

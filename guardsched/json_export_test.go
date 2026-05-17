package guardsched

import (
	"reflect"
	"testing"
)

func TestAssignmentOccupiedBlocks(t *testing.T) {
	blocksPd := 6
	cases := []struct {
		rec  *AssignmentRecord
		want []int
	}{
		{&AssignmentRecord{Kind: "rotating", CalendarBlock: 2}, []int{2}},
		{
			&AssignmentRecord{Kind: "full_day", WinStartBlock: 1, WinEndBlock: 4},
			[]int{1, 2, 3, 4},
		},
		{
			&AssignmentRecord{Kind: "windowed", WinStartBlock: 0, WinEndBlock: 2},
			[]int{0, 1, 2},
		},
	}
	for _, tc := range cases {
		got := AssignmentOccupiedBlocks(tc.rec, blocksPd)
		if !reflect.DeepEqual(got, tc.want) {
			t.Fatalf("kind=%q: got %v want %v", tc.rec.Kind, got, tc.want)
		}
	}
}

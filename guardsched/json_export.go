package guardsched

import (
	"encoding/json"
	"fmt"
)

// BuildScheduleCompareMatrix returns matrix[day][block][slot] = soldier index (rotating-only rows).
func BuildScheduleCompareMatrix(assignments []*Assignment, days, blocksPd, slotsPerBlock int) [][][]int {
	mat := make([][][]int, days)
	for d := range mat {
		mat[d] = make([][]int, blocksPd)
		for b := range mat[d] {
			mat[d][b] = make([]int, slotsPerBlock)
			for j := range mat[d][b] {
				mat[d][b][j] = -1
			}
		}
	}
	for _, a := range assignments {
		if a.Kind != "rotating" {
			panic("BuildScheduleCompareMatrix: only rotating supported")
		}
		if mat[a.Day][a.CalendarBlock][a.Slot] != -1 && mat[a.Day][a.CalendarBlock][a.Slot] != a.SoldierIdx {
			panic("matrix conflict")
		}
		mat[a.Day][a.CalendarBlock][a.Slot] = a.SoldierIdx
	}
	for d := 0; d < days; d++ {
		for b := 0; b < blocksPd; b++ {
			for j := 0; j < slotsPerBlock; j++ {
				if mat[d][b][j] < 0 {
					panic(fmt.Sprintf("empty cell day=%d block=%d slot=%d", d, b, j))
				}
			}
		}
	}
	return mat
}

// ScheduleCompareMap builds the canonical JSON object (encoding/json sorts map keys).
func ScheduleCompareMap(
	z *Zone,
	assignments []*Assignment,
	days, blocksPd, slotsPerBlock int,
	blockHours float64,
	numSoldiers int,
	extra map[string]any,
) map[string]any {
	mat := BuildScheduleCompareMatrix(assignments, days, blocksPd, slotsPerBlock)
	meta := map[string]any{
		"days":           days,
		"blocks_per_day": blocksPd,
		"slots":          slotsPerBlock,
		"shift_hours":    blockHours,
		"soldiers":       numSoldiers,
		"schema_version": 2,
	}
	for k, v := range extra {
		meta[k] = v
	}
	doc := map[string]any{
		"format_version": 1,
		"meta":           meta,
	}
	for d := 0; d < days; d++ {
		doc[fmt.Sprintf("day%d", d)] = map[string]any{"matrix": mat[d]}
	}
	_ = z
	return doc
}

// MarshalScheduleJSON indents like Python's json.dumps(..., indent=2).
func MarshalScheduleJSON(doc map[string]any) ([]byte, error) {
	return json.MarshalIndent(doc, "", "  ")
}

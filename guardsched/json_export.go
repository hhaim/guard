package guardsched

import (
	"encoding/json"
	"fmt"
)

// AssignmentOccupiedBlocks lists duty calendar blocks for matrix export (matches Python).
func AssignmentOccupiedBlocks(a *AssignmentRecord, blocksPd int) []int {
	if a == nil {
		return nil
	}
	k := a.Kind
	if k == "" {
		k = "rotating"
	}
	switch k {
	case "full_day", "windowed":
		_ = blocksPd
		var blocks []int
		for b := a.WinStartBlock; b <= a.WinEndBlock; b++ {
			blocks = append(blocks, b)
		}
		return blocks
	default:
		return []int{a.CalendarBlock}
	}
}

// BuildScheduleCompareMatrixFromRecords builds matrix[day][block][slot] = soldier index.
func BuildScheduleCompareMatrixFromRecords(
	assignments []*AssignmentRecord,
	days, blocksPd, slotsPerBlock int,
) [][][]int {
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
		if a == nil {
			continue
		}
		k := a.Kind
		if k == "" {
			k = "rotating"
		}
		switch k {
		case "rotating":
			if mat[a.Day][a.CalendarBlock][a.Slot] != -1 && mat[a.Day][a.CalendarBlock][a.Slot] != a.SoldierIdx {
				panic("schedule matrix conflict (rotating)")
			}
			mat[a.Day][a.CalendarBlock][a.Slot] = a.SoldierIdx
		case "full_day", "windowed":
			for _, bb := range AssignmentOccupiedBlocks(a, blocksPd) {
				cur := mat[a.Day][bb][a.Slot]
				if cur != -1 && cur != a.SoldierIdx {
					panic("schedule matrix conflict (spanning duty)")
				}
				mat[a.Day][bb][a.Slot] = a.SoldierIdx
			}
		default:
			panic(fmt.Sprintf("unknown assignment kind %q", k))
		}
	}
	for d := 0; d < days; d++ {
		for b := 0; b < blocksPd; b++ {
			for j := 0; j < slotsPerBlock; j++ {
				if mat[d][b][j] < 0 {
					panic(fmt.Sprintf("schedule matrix has empty cell day=%d block=%d slot=%d", d, b, j))
				}
			}
		}
	}
	return mat
}

// BuildScheduleCompareMatrix fills matrices from all-rotating Assignment rows only.
func BuildScheduleCompareMatrix(assignments []*Assignment, days, blocksPd, slotsPerBlock int) [][][]int {
	recs := make([]*AssignmentRecord, 0, len(assignments))
	for _, a := range assignments {
		if a == nil {
			continue
		}
		k := a.Kind
		if k == "" {
			k = "rotating"
		}
		if k != "rotating" {
			panic("BuildScheduleCompareMatrix: only rotating supported")
		}
		recs = append(recs, &AssignmentRecord{
			Day: a.Day, CalendarBlock: a.CalendarBlock, Slot: a.Slot, SoldierIdx: a.SoldierIdx, Kind: k,
		})
	}
	return BuildScheduleCompareMatrixFromRecords(recs, days, blocksPd, slotsPerBlock)
}

// ScheduleCompareFromRecords builds the canonical JSON object (encoding/json sorts map keys).
func ScheduleCompareFromRecords(
	zone *ZoneConfig,
	assignments []*AssignmentRecord,
	days, blocksPd, slotsPerBlock, numSoldiers int,
	blockHours float64,
	extra map[string]any,
) map[string]any {
	mat := BuildScheduleCompareMatrixFromRecords(assignments, days, blocksPd, slotsPerBlock)
	schemaVer := 2
	if zone != nil && zone.SchemaVersion > 0 {
		schemaVer = zone.SchemaVersion
	}
	meta := map[string]any{
		"days":           days,
		"blocks_per_day": blocksPd,
		"slots":          slotsPerBlock,
		"shift_hours":    blockHours,
		"soldiers":       numSoldiers,
		"schema_version": schemaVer,
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
	return doc
}

// ScheduleCompareMap builds the canonical JSON object from legacy Assignment values.
func ScheduleCompareMap(
	z *Zone,
	assignments []*Assignment,
	days, blocksPd, slotsPerBlock int,
	blockHours float64,
	numSoldiers int,
	extra map[string]any,
) map[string]any {
	_ = z
	recs := make([]*AssignmentRecord, 0, len(assignments))
	for _, a := range assignments {
		if a == nil {
			continue
		}
		k := a.Kind
		if k == "" {
			k = "rotating"
		}
		recs = append(recs, &AssignmentRecord{
			Day: a.Day, CalendarBlock: a.CalendarBlock, Slot: a.Slot, SoldierIdx: a.SoldierIdx, Kind: k,
		})
	}
	var zc *ZoneConfig
	if z != nil {
		zc = &ZoneConfig{SchemaVersion: 2}
	}
	return ScheduleCompareFromRecords(zc, recs, days, blocksPd, slotsPerBlock, numSoldiers, blockHours, extra)
}

// MarshalScheduleJSON indents like Python's json.dumps(..., indent=2).
func MarshalScheduleJSON(doc map[string]any) ([]byte, error) {
	return json.MarshalIndent(doc, "", "  ")
}

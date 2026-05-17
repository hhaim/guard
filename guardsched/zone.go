package guardsched

import (
	"fmt"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

// LoadZoneAllRotating loads schema v2 YAML where every slot pattern is "rotating".
func LoadZoneAllRotating(path string, slotsPerBlock int, shiftHoursOverride *float64) (*Zone, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var data map[string]any
	if err := yaml.Unmarshal(raw, &data); err != nil {
		return nil, err
	}
	if int(intFromAny(data["schema_version"], 1)) < 2 || data["slots_types"] == nil {
		return nil, fmt.Errorf("go loader: need schema_version>=2 and slots_types (use Python for legacy v1)")
	}
	stypes := data["slots_types"].([]any)
	typeMap := map[string]string{}
	for _, row := range stypes {
		m := row.(map[string]any)
		id := strings.TrimSpace(fmt.Sprint(m["id"]))
		pat := strings.TrimSpace(fmt.Sprint(m["pattern"]))
		typeMap[id] = pat
	}
	locsRaw := zoneLocYAMLList(data)
	locs, ok := locsRaw.([]any)
	if !ok || len(locs) == 0 {
		return nil, fmt.Errorf("go loader: zone_loc list required")
	}
	typeByLocIdx := make([]string, len(locs))
	locWeights := make([]float64, len(locs))
	for i, row := range locs {
		m := row.(map[string]any)
		lt := strings.TrimSpace(fmt.Sprint(m["type"]))
		typeByLocIdx[i] = typeMap[lt]
		locWeights[i] = floatFromAny(m["weight"])
	}
	slotRows := data["slots"].([]any)
	if len(slotRows) != slotsPerBlock {
		return nil, fmt.Errorf("slots list length %d != slotsPerBlock %d", len(slotRows), slotsPerBlock)
	}
	slotLoc := make([]int, slotsPerBlock)
	slotPatterns := make([]string, slotsPerBlock)
	locIDToIdx := map[string]int{}
	for i, row := range locs {
		m := row.(map[string]any)
		locIDToIdx[strings.TrimSpace(fmt.Sprint(m["id"]))] = i
	}
	for si, row := range slotRows {
		m, ok := row.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("slot %d: expected mapping", si)
		}
		lid := strings.TrimSpace(fmt.Sprint(m["location_id"]))
		li, ok := locIDToIdx[lid]
		if !ok {
			return nil, fmt.Errorf("unknown location_id %q", lid)
		}
		slotLoc[si] = li
		pat := typeByLocIdx[li]
		slotPatterns[si] = pat
		if pat != "rotating" {
			return nil, fmt.Errorf("go loader: slot %d uses pattern %q (only all-rotating zones supported)", si, pat)
		}
	}
	tzs := data["time_zones"].([]any)
	var tFrom, tTo []int
	var tW []float64
	defFrom := []int{0, 6, 12}
	defTo := []int{5, 11, 23}
	for i, row := range tzs {
		m := row.(map[string]any)
		di := i
		if di >= len(defFrom) {
			di = len(defFrom) - 1
		}
		tFrom = append(tFrom, int(intFromAny(m["from_hour"], defFrom[di])))
		tTo = append(tTo, int(intFromAny(m["to_hour"], defTo[di])))
		tW = append(tW, floatFromAny(m["weight"]))
	}
	sh := floatFromAny(data["shift_hours"])
	if shiftHoursOverride != nil {
		sh = *shiftHoursOverride
	}
	if _, err := CalendarBlocksPerDaySafe(sh); err != nil {
		return nil, err
	}
	return &Zone{
		ShiftHours:      sh,
		LocWeights:      locWeights,
		TimeWeights:     tW,
		TimeFrom:        tFrom,
		TimeTo:          tTo,
		SlotLocationIdx: slotLoc,
		SlotPatterns:    slotPatterns,
	}, nil
}

func floatFromAny(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case int:
		return float64(x)
	case int64:
		return float64(x)
	default:
		panic(fmt.Sprintf("floatFromAny: %T", v))
	}
}

func intFromAny(v any, def int) int {
	if v == nil {
		return def
	}
	switch x := v.(type) {
	case int:
		return x
	case int64:
		return int(x)
	case float64:
		return int(x)
	default:
		return def
	}
}

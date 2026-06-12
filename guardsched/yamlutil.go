package guardsched

import (
	"fmt"
	"strings"

	"gopkg.in/yaml.v3"
)

// CountYAMLSlots returns len(slots) or len(slot_locations), or -1 if absent.
func CountYAMLSlots(raw []byte) int {
	var root map[string]any
	if err := yaml.Unmarshal(raw, &root); err != nil {
		return -1
	}
	if slots, ok := root["slots"].([]any); ok && len(slots) > 0 {
		return len(slots)
	}
	if sl2, ok := root["slot_locations"].([]any); ok && len(sl2) > 0 {
		return len(sl2)
	}
	return -1
}

// ZonesYAMLForSimulation returns YAML with disabled slot rows removed and enabled slot count.
func ZonesYAMLForSimulation(raw []byte) (filtered []byte, enabledCount int, err error) {
	var root map[string]any
	if err := yaml.Unmarshal(raw, &root); err != nil {
		return nil, 0, err
	}
	key := "slots"
	slotsRaw, ok := root[key].([]any)
	if !ok || len(slotsRaw) == 0 {
		if sl2, ok2 := root["slot_locations"].([]any); ok2 && len(sl2) > 0 {
			key = "slot_locations"
			slotsRaw = sl2
		} else {
			return raw, 0, nil
		}
	}
	enabled := make([]any, 0, len(slotsRaw))
	for _, entry := range slotsRaw {
		m, ok := entry.(map[string]any)
		if !ok {
			enabled = append(enabled, entry)
			continue
		}
		if boolFromAny(m["disabled"]) {
			continue
		}
		enabled = append(enabled, entry)
	}
	root[key] = enabled
	out, err := yaml.Marshal(root)
	if err != nil {
		return nil, 0, err
	}
	return out, len(enabled), nil
}

func boolFromAny(v any) bool {
	switch t := v.(type) {
	case bool:
		return t
	case string:
		return strings.EqualFold(strings.TrimSpace(t), "true")
	default:
		return false
	}
}

// CountEnabledYAMLSlots returns enabled slot count (disabled rows excluded).
func CountEnabledYAMLSlots(raw []byte) int {
	_, n, err := ZonesYAMLForSimulation(raw)
	if err != nil || n < 0 {
		return CountYAMLSlots(raw)
	}
	return n
}

// ResolveSlotsPerBlock returns -y if set, else YAML enabled slots list length.
func ResolveSlotsPerBlock(slotsArg *int, raw []byte, zonesPath string) (int, error) {
	yamlN := CountEnabledYAMLSlots(raw)
	if slotsArg == nil {
		if yamlN < 1 {
			return 0, fmt.Errorf("%s: no 'slots' list; pass -y/--slots", zonesPath)
		}
		return yamlN, nil
	}
	if yamlN > 0 && *slotsArg != yamlN {
		return 0, fmt.Errorf(
			"%s defines %d slots; you passed -y %d (omit -y to use file count)",
			zonesPath, yamlN, *slotsArg,
		)
	}
	return *slotsArg, nil
}

// SoldierKeys builds s0, s1, … s{n-1}.
func SoldierKeys(n int) []string {
	keys := make([]string, n)
	for i := 0; i < n; i++ {
		keys[i] = fmt.Sprintf("s%d", i)
	}
	return keys
}

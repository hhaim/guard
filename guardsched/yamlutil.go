package guardsched

import (
	"fmt"

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

// ResolveSlotsPerBlock returns -y if set, else YAML slots list length.
func ResolveSlotsPerBlock(slotsArg *int, raw []byte, zonesPath string) (int, error) {
	yamlN := CountYAMLSlots(raw)
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

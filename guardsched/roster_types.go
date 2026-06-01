package guardsched

import (
	"fmt"
	"strings"

	"gopkg.in/yaml.v3"
)

func rosterString(m map[string]any, key string) string {
	v, ok := m[key]
	if !ok || v == nil {
		return ""
	}
	s := strings.TrimSpace(fmt.Sprint(v))
	if s == "<nil>" {
		return ""
	}
	return s
}

// DefaultTypeCodes returns A,B,C,D cycling type codes for n soldiers (sim/tests without roster YAML).
func DefaultTypeCodes(n int) []string {
	types := []string{"A", "B", "C", "D"}
	out := make([]string, n)
	for i := 0; i < n; i++ {
		out[i] = types[i%len(types)]
	}
	return out
}

// TypeCodesForRoster returns type_code per roster index (empty string if unknown).
func TypeCodesForRoster(keys []string, idToType map[string]string) []string {
	out := make([]string, len(keys))
	for i, k := range keys {
		out[i] = strings.TrimSpace(idToType[k])
	}
	return out
}

// TODO: load platoon by soldier id for zone constraints (platoon_code on soldiers[]).

// LoadRosterTypeCodesYAML reads soldiers[].type_code from roster YAML in roster key order.
// platoon_code on soldiers is ignored until scheduler support is added.
func LoadRosterTypeCodesYAML(raw []byte, keys []string) ([]string, error) {
	var root any
	if err := yaml.Unmarshal(raw, &root); err != nil {
		return nil, err
	}
	data, ok := root.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("roster YAML must be a mapping at top level")
	}
	rawSoldiers, ok := data["soldiers"]
	if !ok {
		return nil, fmt.Errorf("roster YAML must include soldiers list")
	}
	var list []any
	if uiRows, ok := rawSoldiers.([]any); ok {
		list = uiRows
	} else if nested, ok := rawSoldiers.(map[string]any); ok {
		if legacyRows, ok := nested["soldiers"].([]any); ok {
			list = legacyRows
		}
	}
	if list == nil {
		return nil, fmt.Errorf("roster YAML must include soldiers list")
	}
	idToType := map[string]string{}
	for _, row := range list {
		m, ok := row.(map[string]any)
		if !ok {
			continue
		}
		id := rosterString(m, "id")
		if id == "" {
			id = rosterString(m, "key")
		}
		tc := rosterString(m, "type_code")
		if id != "" && tc != "" {
			idToType[id] = tc
		}
	}
	return TypeCodesForRoster(keys, idToType), nil
}

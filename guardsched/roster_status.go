package guardsched

import (
	"fmt"
	"strings"
	"time"

	"guard/internal/availability"

	"gopkg.in/yaml.v3"
)

// LoadRosterStatusYAML reads soldier_status.entries from roster YAML (UI export shape).
func LoadRosterStatusYAML(raw []byte) ([]availability.Entry, error) {
	var root any
	if err := yaml.Unmarshal(raw, &root); err != nil {
		return nil, err
	}
	data, ok := root.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("roster YAML must be a mapping at top level")
	}
	rawStatus, ok := data["soldier_status"]
	if !ok || rawStatus == nil {
		return nil, nil
	}
	block, ok := rawStatus.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("soldier_status must be a mapping")
	}
	rawEntries, _ := block["entries"].([]any)
	var out []availability.Entry
	for i, row := range rawEntries {
		m, ok := row.(map[string]any)
		if !ok {
			continue
		}
		sid := rosterString(m, "soldier_id")
		if sid == "" {
			sid = rosterString(m, "soldier")
		}
		st := availability.NormalizeStatus(rosterString(m, "status"))
		if !availability.IsBlockingStatus(st) {
			continue
		}
		startS := rosterString(m, "start_at")
		if startS == "" {
			return nil, fmt.Errorf("soldier_status.entries[%d]: missing start_at", i)
		}
		startAt, err := time.Parse(time.RFC3339, startS)
		if err != nil {
			return nil, fmt.Errorf("soldier_status.entries[%d]: bad start_at: %w", i, err)
		}
		var endAt *time.Time
		if endS := rosterString(m, "end_at"); endS != "" {
			t, err := time.Parse(time.RFC3339, endS)
			if err != nil {
				return nil, fmt.Errorf("soldier_status.entries[%d]: bad end_at: %w", i, err)
			}
			endAt = &t
		}
		out = append(out, availability.Entry{
			SoldierID: sid,
			StartAt:   startAt.UTC(),
			EndAt:     endAt,
			Status:    st,
		})
	}
	return out, nil
}

// LoadRosterSoldierIDsYAML returns soldier ids in roster YAML list order.
func LoadRosterSoldierIDsYAML(raw []byte) ([]string, error) {
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
	var ids []string
	for _, row := range list {
		m, ok := row.(map[string]any)
		if !ok {
			continue
		}
		id := rosterString(m, "id")
		if id == "" {
			id = rosterString(m, "key")
		}
		if id != "" {
			ids = append(ids, id)
		}
	}
	return availability.RosterFromIDs(ids), nil
}

// BuildRosterAvailabilityChecker compiles plan-day availability from roster status entries.
func BuildRosterAvailabilityChecker(
	anchor time.Time,
	planDayStartHour int,
	roster []string,
	entries []availability.Entry,
	days int,
) *availability.Checker {
	if len(entries) == 0 {
		return nil
	}
	if days < 1 {
		days = 1
	}
	anchor = time.Date(anchor.Year(), anchor.Month(), anchor.Day(), 0, 0, 0, 0, time.UTC)
	return availability.NewChecker(anchor, planDayStartHour, roster, entries, days)
}

// RosterIndexMap maps soldier id → simulation index for roster ordered s0..s{n-1} or explicit ids.
func RosterIndexMap(roster []string) map[string]int {
	m := make(map[string]int, len(roster))
	for i, id := range roster {
		m[strings.TrimSpace(id)] = i
	}
	return m
}

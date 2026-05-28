package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"guard/guardsched"
	"guard/internal/availability"
	"guard/internal/model"
	"guard/internal/repo"
)

type scheduleRunBody struct {
	AnchorDate              string   `json:"anchor_date"` // YYYY-MM-DD
	Days                    int      `json:"days"`
	Seed                    *int64   `json:"seed"`
	ShiftHours              *float64 `json:"shift_hours"`
	MinConsecutiveFreeHours *float64 `json:"min_consecutive_free_hours"`
	MinFreeShiftsAfterDuty  *int     `json:"min_free_shifts_after_duty"`
	BandRelative            *float64 `json:"band_relative"`
	SimTrials               *int     `json:"sim_trials"`
	DebugDayOffset          *int     `json:"debug_day_offset,omitempty"` // per-request; testing only
}

type simRunOutput struct {
	Anchor       time.Time
	Days         int
	ShiftHours   float64
	SoldierKeys  []string
	SlotLabels   []string
	Records      []*guardsched.AssignmentRecord
	Stats        *guardsched.SimulationStats
	TrialMeta    map[string]any
	AssignJSON   []map[string]any
	BlocksPerDay int
	Soldiers     map[string]model.PlanDaySoldiers
	Meta         map[string]any
}

func parseAnchorDate(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, fmt.Errorf("anchor_date required")
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid anchor_date")
	}
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC), nil
}

const maxPlanDebugDayOffset = 366

func utcToday() time.Time {
	return time.Now().UTC().Truncate(24 * time.Hour)
}

func clampPlanDebugDayOffset(n int) int {
	if n < 0 {
		return 0
	}
	if n > maxPlanDebugDayOffset {
		return maxPlanDebugDayOffset
	}
	return n
}

func (s *Server) planDebugOffset(offset int) int {
	return clampPlanDebugDayOffset(offset)
}

func (s *Server) effectiveTodayUTC(offset int) time.Time {
	return utcToday().AddDate(0, 0, s.planDebugOffset(offset))
}

func (s *Server) allowedPlanAnchor(offset int) time.Time {
	return s.effectiveTodayUTC(offset).AddDate(0, 0, 1)
}

func (s *Server) validatePlanAnchor(anchor time.Time, offset int) error {
	want := s.allowedPlanAnchor(offset)
	a := time.Date(anchor.Year(), anchor.Month(), anchor.Day(), 0, 0, 0, 0, time.UTC)
	if !a.Equal(want) {
		return fmt.Errorf("anchor_date must be %s (next planning day from effective today UTC)", want.Format("2006-01-02"))
	}
	return nil
}

func buildPlanDaysMeta(anchor time.Time, days, planStartHour int) []map[string]any {
	out := make([]map[string]any, days)
	for d := 0; d < days; d++ {
		dt := anchor.AddDate(0, 0, d)
		wd := guardsched.WeekdayAtPlanDayStart(anchor, d, planStartHour)
		out[d] = map[string]any{
			"day":            d,
			"calendar_date":  dt.Format("2006-01-02"),
			"weekday":        guardsched.WeekdayLongName(wd),
		}
	}
	return out
}

func globalPlanDayStartFromCfg(value json.RawMessage) (hour int, raw string, err error) {
	raw = guardsched.DefaultPlanDayStart
	var g struct {
		PlanDayStart string `json:"plan_day_start"`
	}
	if len(value) > 0 {
		_ = json.Unmarshal(value, &g)
	}
	if s := strings.TrimSpace(g.PlanDayStart); s != "" {
		raw = s
	}
	hour, err = guardsched.ParsePlanDayStart(raw)
	return hour, raw, err
}

func (s *Server) globalPlanDebugOffset(ctx context.Context) int {
	row, err := repo.GetCfg(ctx, s.Pool, "global")
	if err != nil || row.Version == 0 {
		return s.PlanDebugDayOffset
	}
	var g struct {
		PlanDebugDayOffset int `json:"plan_debug_day_offset"`
	}
	if err := json.Unmarshal(row.Value, &g); err != nil {
		return s.PlanDebugDayOffset
	}
	return clampPlanDebugDayOffset(g.PlanDebugDayOffset)
}

// resolvePlanDebugOffset picks the day offset for planning: request override, then global cfg, then env.
func (s *Server) resolvePlanDebugOffset(ctx context.Context, r *http.Request, bodyOffset *int) int {
	if s.AllowDebugOffset {
		if bodyOffset != nil && *bodyOffset >= 0 {
			return clampPlanDebugDayOffset(*bodyOffset)
		}
		q := strings.TrimSpace(r.URL.Query().Get("debug_day_offset"))
		if q != "" {
			var n int
			if _, err := fmt.Sscanf(q, "%d", &n); err == nil && n >= 0 {
				return clampPlanDebugDayOffset(n)
			}
		}
	}
	return s.globalPlanDebugOffset(ctx)
}

func validProposalSlot(slot string) bool {
	switch slot {
	case "01", "02", "03", "04":
		return true
	default:
		return false
	}
}

func (s *Server) runScheduleSimulation(ctx context.Context, body scheduleRunBody) (*simRunOutput, int, string, error) {
	if body.Days <= 0 {
		body.Days = 1
	}
	anchor, err := parseAnchorDate(body.AnchorDate)
	if err != nil {
		return nil, 400, `{"error":"anchor_date required (YYYY-MM-DD)"}`, err
	}

	slotsRow, err := repo.GetCfg(ctx, s.Pool, "slots")
	if err != nil {
		return nil, 500, err.Error(), err
	}
	soldiersRow, err := repo.GetCfg(ctx, s.Pool, "soldiers")
	if err != nil {
		return nil, 500, err.Error(), err
	}
	globalRow, err := repo.GetCfg(ctx, s.Pool, "global")
	if err != nil {
		return nil, 500, err.Error(), err
	}

	var global struct {
		HistoryDays   int    `json:"history_days"`
		RandomSeed    int64  `json:"random_seed"`
		PlanDayStart  string `json:"plan_day_start"`
	}
	_ = json.Unmarshal(globalRow.Value, &global)
	planDayStartStr := strings.TrimSpace(global.PlanDayStart)
	if planDayStartStr == "" {
		planDayStartStr = guardsched.DefaultPlanDayStart
	}
	planDayStartHour, err := guardsched.ParsePlanDayStart(planDayStartStr)
	if err != nil {
		return nil, 400, fmt.Sprintf(`{"error":%q}`, err.Error()), err
	}
	if global.HistoryDays > 0 && body.Days > global.HistoryDays {
		body.Days = global.HistoryDays
	}
	var seedPtr *int64
	if body.Seed != nil {
		seedPtr = body.Seed
	} else if global.RandomSeed != 0 {
		sv := global.RandomSeed
		seedPtr = &sv
	}

	trials := 1
	if body.SimTrials != nil && *body.SimTrials > 0 {
		trials = *body.SimTrials
	}
	if trials > 1 && seedPtr == nil {
		return nil, 400, `{"error":"sim_trials > 1 requires seed"}`, fmt.Errorf("sim_trials > 1 requires seed")
	}

	minFreeH := 6.0
	if body.MinConsecutiveFreeHours != nil {
		minFreeH = *body.MinConsecutiveFreeHours
	}
	minCool := 2
	if body.MinFreeShiftsAfterDuty != nil {
		minCool = *body.MinFreeShiftsAfterDuty
	}
	bandRel := 0.2
	if body.BandRelative != nil {
		bandRel = *body.BandRelative
	}

	var slotsDoc struct {
		ZonesYAML string `json:"zones_yaml"`
	}
	_ = json.Unmarshal(slotsRow.Value, &slotsDoc)
	yamlBytes := []byte(strings.TrimSpace(slotsDoc.ZonesYAML))
	if len(yamlBytes) == 0 {
		var raw any
		if err := json.Unmarshal(slotsRow.Value, &raw); err == nil {
			if st, ok := raw.(string); ok {
				yamlBytes = []byte(strings.TrimSpace(st))
			}
		}
	}
	if len(yamlBytes) == 0 {
		return nil, 400, `{"error":"slots must include zones_yaml string or be a raw YAML string"}`, fmt.Errorf("missing zones_yaml")
	}

	var soldiersDoc struct {
		Soldiers []struct {
			ID       string `json:"id"`
			Key      string `json:"key"`
			FullName string `json:"full_name"`
			State    string `json:"state"`
			TypeCode string `json:"type_code"`
		} `json:"soldiers"`
	}
	if err := json.Unmarshal(soldiersRow.Value, &soldiersDoc); err != nil {
		return nil, 400, err.Error(), err
	}
	var keys []string
	idToType := map[string]string{}
	for _, sol := range soldiersDoc.Soldiers {
		id := sol.ID
		if id == "" {
			id = sol.Key
		}
		if id == "" {
			continue
		}
		keys = append(keys, id)
		if tc := strings.TrimSpace(sol.TypeCode); tc != "" {
			idToType[id] = tc
		}
	}
	keys = availability.RosterFromIDs(keys)
	typeCodes := guardsched.TypeCodesForRoster(keys, idToType)
	if len(keys) < 1 {
		return nil, 400, `{"error":"need at least one soldier"}`, fmt.Errorf("no soldiers")
	}

	slotsPerBlock := countYAMLSlots(yamlBytes)
	if slotsPerBlock < 1 {
		return nil, 400, `{"error":"could not determine slots count from YAML"}`, fmt.Errorf("bad yaml slots")
	}
	if len(keys) < slotsPerBlock {
		return nil, 400, fmt.Sprintf(`{"error":"need at least %d soldiers"}`, slotsPerBlock), fmt.Errorf("not enough soldiers")
	}

	zc, err := guardsched.LoadZoneConfigYAML(yamlBytes, slotsPerBlock, body.ShiftHours)
	if err != nil {
		return nil, 400, fmt.Sprintf(`{"error":%q}`, err.Error()), err
	}

	availChecker, soldiersByDay, err := s.buildPlanAvailability(ctx, anchor, body.Days, planDayStartHour, keys)
	if err != nil {
		return nil, 500, err.Error(), err
	}

	recs, stats, trialMeta, err := guardsched.RunSimulationBestOfZoneConfig(
		zc, len(keys), body.Days, trials, seedPtr,
		minFreeH, true, 0, 2, minCool, bandRel,
		planDayStartHour, availChecker, &anchor, typeCodes,
	)
	if err != nil {
		return nil, 422, fmt.Sprintf(`{"error":%q}`, err.Error()), err
	}

	slotLabels := make([]string, len(zc.Slots))
	for i, sl := range zc.Slots {
		slotLabels[i] = sl.DisplayName
	}
	bp, _ := guardsched.CalendarBlocksPerDaySafe(zc.ShiftHours)
	assignJSON := guardsched.AssignmentRecordsToJSON(recs, keys)

	return &simRunOutput{
		Anchor:       anchor,
		Days:         body.Days,
		ShiftHours:   zc.ShiftHours,
		SoldierKeys:  keys,
		SlotLabels:   slotLabels,
		Records:      recs,
		Stats:        stats,
		TrialMeta:    trialMeta,
		AssignJSON:   assignJSON,
		BlocksPerDay: bp,
		Soldiers:     soldiersByDay,
		Meta: map[string]any{
			"sim_trials":                     trials,
			"trial":                          trialMeta,
			"min_consecutive_free_hours":     minFreeH,
			"min_free_shifts_after_duty":     minCool,
			"band_relative":                  bandRel,
			"shift_cooldown_exclusions":      stats.ShiftCooldownExclusions,
			"shift_cooldown_pool_iterations": stats.ShiftCooldownPoolIterations,
			"plan_day_start":                 planDayStartStr,
			"plan_day_start_hour":            planDayStartHour,
			"plan_days":                      buildPlanDaysMeta(anchor, body.Days, planDayStartHour),
		},
	}, 0, "", nil
}

// loadPlanInputs reads cfg needed to convert proposals or apply to schedule rows.
func (s *Server) loadPlanInputs(ctx context.Context) (yamlBytes []byte, soldierKeys []string, slotLabels []string, shiftHours float64, err error) {
	slotsRow, err := repo.GetCfg(ctx, s.Pool, "slots")
	if err != nil {
		return nil, nil, nil, 0, err
	}
	soldiersRow, err := repo.GetCfg(ctx, s.Pool, "soldiers")
	if err != nil {
		return nil, nil, nil, 0, err
	}

	var slotsDoc struct {
		ZonesYAML string  `json:"zones_yaml"`
		ShiftHours *float64 `json:"shift_hours"`
	}
	_ = json.Unmarshal(slotsRow.Value, &slotsDoc)
	yamlBytes = []byte(strings.TrimSpace(slotsDoc.ZonesYAML))
	if len(yamlBytes) == 0 {
		var raw any
		if err := json.Unmarshal(slotsRow.Value, &raw); err == nil {
			if st, ok := raw.(string); ok {
				yamlBytes = []byte(strings.TrimSpace(st))
			}
		}
	}
	if len(yamlBytes) == 0 {
		return nil, nil, nil, 0, fmt.Errorf("missing zones_yaml")
	}

	var soldiersDoc struct {
		Soldiers []struct {
			ID    string `json:"id"`
			Key   string `json:"key"`
			State string `json:"state"`
		} `json:"soldiers"`
	}
	if err := json.Unmarshal(soldiersRow.Value, &soldiersDoc); err != nil {
		return nil, nil, nil, 0, err
	}
	for _, sol := range soldiersDoc.Soldiers {
		id := sol.ID
		if id == "" {
			id = sol.Key
		}
		if id == "" {
			continue
		}
		soldierKeys = append(soldierKeys, id)
	}
	soldierKeys = availability.RosterFromIDs(soldierKeys)

	slotsPerBlock := countYAMLSlots(yamlBytes)
	zc, err := guardsched.LoadZoneConfigYAML(yamlBytes, slotsPerBlock, slotsDoc.ShiftHours)
	if err != nil {
		return nil, nil, nil, 0, err
	}
	shiftHours = zc.ShiftHours
	slotLabels = make([]string, len(zc.Slots))
	for i, sl := range zc.Slots {
		slotLabels[i] = sl.DisplayName
	}
	return yamlBytes, soldierKeys, slotLabels, shiftHours, nil
}

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
	Continuation *model.SimContinuation
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

func (s *Server) runScheduleSimulation(ctx context.Context, body scheduleRunBody, debugOffset int, slot string) (*simRunOutput, *APIErrorBody) {
	req := scheduleRunRequestSnapshot(body, slot)
	proc := s.baseSimProcessing(debugOffset)

	if body.Days <= 0 {
		body.Days = 1
	}
	req["days"] = body.Days

	anchor, err := parseAnchorDate(body.AnchorDate)
	if err != nil {
		return nil, validationFailure("anchor_date required (YYYY-MM-DD)", err.Error(), req, proc)
	}
	proc["plan_anchor_date"] = anchor.Format("2006-01-02")

	slotsRow, err := repo.GetCfg(ctx, s.Pool, "slots")
	if err != nil {
		return nil, internalFailure(err.Error(), req)
	}
	soldiersRow, err := repo.GetCfg(ctx, s.Pool, "soldiers")
	if err != nil {
		return nil, internalFailure(err.Error(), req)
	}
	globalRow, err := repo.GetCfg(ctx, s.Pool, "global")
	if err != nil {
		return nil, internalFailure(err.Error(), req)
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
		return nil, validationFailure("invalid plan_day_start", err.Error(), req, proc)
	}
	if global.HistoryDays <= 0 {
		global.HistoryDays = 14
	}
	planDays := body.Days
	proc["history_days"] = global.HistoryDays
	proc["plan_day_start"] = planDayStartStr
	proc["plan_day_start_hour"] = planDayStartHour
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
		return nil, validationFailure(
			"Seed required for multiple trials",
			"sim_trials > 1 requires seed",
			req, proc,
			"Provide an integer seed when sim trials is greater than 1.",
		)
	}
	proc["sim_trials"] = trials

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
		return nil, validationFailure(
			"Zones configuration missing",
			"slots must include zones_yaml string or be a raw YAML string",
			req, proc,
			"Configure zones YAML in the Slots tab.",
		)
	}

	var soldiersDoc struct {
		Soldiers []struct {
			ID          string `json:"id"`
			Key         string `json:"key"`
			FullName    string `json:"full_name"`
			State       string `json:"state"`
			TypeCode    string `json:"type_code"`
			PlatoonCode string `json:"platoon_code"`
		} `json:"soldiers"`
	}
	if err := json.Unmarshal(soldiersRow.Value, &soldiersDoc); err != nil {
		return nil, validationFailure("Invalid soldiers configuration", err.Error(), req, proc)
	}
	var keys []string
	idToType := map[string]string{}
	idToPlatoon := map[string]string{}
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
		if pc := strings.TrimSpace(sol.PlatoonCode); pc != "" {
			idToPlatoon[id] = pc
		}
	}
	keys = availability.RosterFromIDs(keys)
	typeCodes := guardsched.TypeCodesForRoster(keys, idToType)
	platoonCodes := guardsched.PlatoonCodesForRoster(keys, idToPlatoon)
	proc["soldier_count"] = len(keys)
	if len(keys) < 1 {
		return nil, validationFailure("No soldiers in roster", "need at least one soldier", req, proc, "Add soldiers in the Soldiers tab.")
	}

	simYaml, slotsPerBlock, err := guardsched.ZonesYAMLForSimulation(yamlBytes)
	if err != nil {
		return nil, validationFailure("Invalid zones configuration", err.Error(), req, proc)
	}
	proc["slots_per_block"] = slotsPerBlock
	if slotsPerBlock < 1 {
		return nil, validationFailure("No enabled slots", "no enabled slots in zones config", req, proc, "Enable at least one slot in zones YAML.")
	}
	if len(keys) < slotsPerBlock {
		return nil, validationFailure(
			"Not enough soldiers for slots",
			fmt.Sprintf("need at least %d soldiers", slotsPerBlock),
			req, proc,
			fmt.Sprintf("Roster has %d soldiers but zones require at least %d.", len(keys), slotsPerBlock),
		)
	}

	zc, err := guardsched.LoadZoneConfigYAML(simYaml, slotsPerBlock, body.ShiftHours)
	if err != nil {
		return nil, validationFailure("Invalid zones configuration", err.Error(), req, proc)
	}
	proc["shift_hours"] = zc.ShiftHours
	proc["min_consecutive_free_hours"] = minFreeH
	proc["min_free_shifts_after_duty"] = minCool
	proc["band_relative"] = bandRel

	availChecker, soldiersByDay, err := s.buildPlanAvailability(ctx, anchor, planDays, planDayStartHour, keys)
	if err != nil {
		return nil, internalFailure(err.Error(), req)
	}

	prefix, err := loadVerifiedHistoryPrefix(ctx, s.Pool, anchor, global.HistoryDays, keys, zc.ShiftHours)
	if err != nil {
		code, headline, hints, details := classifySimulationError(err)
		if code == "simulation_failed" {
			code = "history_load_failed"
			headline = "Could not load verified history"
		}
		return nil, simFailure(http.StatusUnprocessableEntity, code, headline, err.Error(), req, proc, hints, details)
	}
	proc["history_prefix_days"] = prefix.Days
	proc["history_dates"] = prefix.Dates
	proc["history_continuation_loaded"] = prefix.Continuation != nil && prefix.Continuation.RNGState != nil

	simMode := "cold"
	var recs []*guardsched.AssignmentRecord
	var stats *guardsched.SimulationStats
	var trialMeta map[string]any
	var contSnap *guardsched.ContinuationSnapshot

	if prefix.Days > 0 && len(prefix.Records) > 0 {
		prefixDays := prefix.Days
		var witness *guardsched.ExtendWitness
		if prefix.Continuation != nil && prefix.Continuation.RNGState != nil {
			witness, _, err = guardsched.ExtendWitnessFromContinuation(prefix.Continuation, prefix.Records, keys)
			if err != nil {
				return nil, simRunErrFromSim(err, req, proc, simMode)
			}
			simMode = "extend_witness"
		} else {
			simMode = "extend_bootstrap_cold"
			if trials > 1 {
				return nil, validationFailure(
					"History bootstrap requires a single simulation trial",
					"history without continuation requires sim_trials 1",
					req, mergeProcessing(proc, map[string]any{"sim_mode": simMode}),
					"Set sim trials to 1, or ensure the latest verified day has a continuation checkpoint.",
				)
			}
			var seedUsed int64
			if seedPtr != nil {
				seedUsed = *seedPtr
			}
			rng := guardsched.NewPyRandom(seedUsed)
			cold, err := guardsched.RunSimulationZoneConfigWithContinuation(
				zc, len(keys), prefixDays+planDays, prefixDays, rng,
				minFreeH, true, 0, 2, minCool, bandRel,
				planDayStartHour, availChecker, &anchor, typeCodes, platoonCodes, seedPtr,
			)
			if err != nil {
				return nil, simRunErrFromSim(err, req, mergeProcessing(proc, map[string]any{"sim_mode": simMode}), simMode)
			}
			seg := make([]*guardsched.AssignmentRecord, 0)
			for _, a := range cold.Records {
				if a != nil && a.Day >= prefixDays {
					cp := *a
					seg = append(seg, &cp)
				}
			}
			recs = guardsched.ReindexExtendSegment(seg, prefixDays)
			stats = cold.Stats
			contSnap = cold.Continuation
			trialMeta = map[string]any{"trials_run": 1, "trial_seed": seedUsed, "witness_extend": false, "bootstrap": "cold"}
		}
		if witness != nil {
			recs, stats, contSnap, trialMeta, err = guardsched.RunSimulationBestOfZoneConfigExtendWitness(
				zc, len(keys), prefixDays, planDays, trials, prefix.Records, seedPtr,
				minFreeH, true, 0, 2, minCool, bandRel,
				planDayStartHour, availChecker, &anchor, typeCodes, platoonCodes, witness,
			)
			if err != nil {
				return nil, simRunErrFromSim(err, req, mergeProcessing(proc, map[string]any{"sim_mode": simMode}), simMode)
			}
			recs = guardsched.ReindexExtendSegment(recs, prefixDays)
		}
	} else {
		if trials > 1 {
			return nil, validationFailure(
				"Cold run requires a single simulation trial",
				"cold continuation capture requires sim_trials 1",
				req, mergeProcessing(proc, map[string]any{"sim_mode": simMode}),
				"Set sim trials to 1 for this configuration.",
			)
		}
		var seedUsed int64
		if seedPtr != nil {
			seedUsed = *seedPtr
		}
		rng := guardsched.NewPyRandom(seedUsed)
		cold, err := guardsched.RunSimulationZoneConfigWithContinuation(
			zc, len(keys), planDays, planDays, rng,
			minFreeH, true, 0, 2, minCool, bandRel,
			planDayStartHour, availChecker, &anchor, typeCodes, platoonCodes, seedPtr,
		)
		if err != nil {
			return nil, simRunErrFromSim(err, req, mergeProcessing(proc, map[string]any{"sim_mode": simMode}), simMode)
		}
		recs = cold.Records
		stats = cold.Stats
		contSnap = cold.Continuation
		trialMeta = map[string]any{"trials_run": 1, "trial_seed": seedUsed}
	}
	if err != nil {
		return nil, simRunErrFromSim(err, req, mergeProcessing(proc, map[string]any{"sim_mode": simMode}), simMode)
	}
	proc["sim_mode"] = simMode

	slotLabels := make([]string, len(zc.Slots))
	for i, sl := range zc.Slots {
		slotLabels[i] = sl.DisplayName
	}
	bp, _ := guardsched.CalendarBlocksPerDaySafe(zc.ShiftHours)
	assignJSON := guardsched.AssignmentRecordsToJSON(recs, keys)

	return &simRunOutput{
		Anchor:       anchor,
		Days:         planDays,
		ShiftHours:   zc.ShiftHours,
		SoldierKeys:  keys,
		SlotLabels:   slotLabels,
		Records:      recs,
		Stats:        stats,
		TrialMeta:    trialMeta,
		AssignJSON:   assignJSON,
		BlocksPerDay: bp,
		Soldiers:     soldiersByDay,
		Continuation: continuationFromSched(contSnap),
		Meta: map[string]any{
			"sim_trials":                     trials,
			"trial":                          trialMeta,
			"sim_mode":                       simMode,
			"continuation_format":          guardsched.CheckpointFormatVersion,
			"history_days":                   global.HistoryDays,
			"history_prefix_days":            prefix.Days,
			"history_dates":                  prefix.Dates,
			"history_assignments_replayed":   prefix.AssignmentsReplayed,
			"history_assignments_skipped":    prefix.AssignmentsSkipped,
			"history_continuation_loaded":    prefix.Continuation != nil && prefix.Continuation.RNGState != nil,
			"min_consecutive_free_hours":     minFreeH,
			"min_free_shifts_after_duty":     minCool,
			"band_relative":                  bandRel,
			"shift_cooldown_exclusions":      stats.ShiftCooldownExclusions,
			"shift_cooldown_pool_iterations": stats.ShiftCooldownPoolIterations,
			"plan_day_start":                 planDayStartStr,
			"plan_day_start_hour":            planDayStartHour,
			"plan_days":                      buildPlanDaysMeta(anchor, planDays, planDayStartHour),
		},
	}, nil
}

func simRunErrFromSim(err error, req, proc map[string]any, simMode string) *APIErrorBody {
	if simMode != "" {
		proc = mergeProcessing(proc, map[string]any{"sim_mode": simMode})
	}
	code, headline, hints, details := classifySimulationError(err)
	return simFailure(http.StatusUnprocessableEntity, code, headline, err.Error(), req, proc, hints, details)
}

// loadPlanInputs reads cfg needed to convert proposals or apply to schedule rows.
// soldiers cfg may include platoon_code (UI/roster); used for full_day_team pin_platoon slots.
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

	simYaml, slotsPerBlock, err := guardsched.ZonesYAMLForSimulation(yamlBytes)
	if err != nil {
		return nil, nil, nil, 0, err
	}
	if slotsPerBlock < 1 {
		return nil, nil, nil, 0, fmt.Errorf("no enabled slots in zones config")
	}
	zc, err := guardsched.LoadZoneConfigYAML(simYaml, slotsPerBlock, slotsDoc.ShiftHours)
	if err != nil {
		return nil, nil, nil, 0, err
	}
	shiftHours = zc.ShiftHours
	slotLabels = make([]string, len(zc.Slots))
	for i, sl := range zc.Slots {
		slotLabels[i] = sl.DisplayName
	}
	return simYaml, soldierKeys, slotLabels, shiftHours, nil
}

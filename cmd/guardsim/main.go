// guardsim — CLI for guard zone scheduling (parity with guard_scheduler_sim.py).
//
// Example:
//
//	go run ./cmd/guardsim -x 12 -y 4 -d 1 --zones zones_s1.yaml \
//	  --shift-hours 4 --min-free-shifts-after-duty 2 --min-consecutive-free-hours 6 --band-relative 0.2
//
// Scenario YAML (status + expectations):
//
//	go run ./cmd/guardsim --scenario testdata/scenarios/partial_return.yaml
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"guard/guardsched"
	"guard/internal/availability"
)

const (
	defaultMinFreeHours  = 6.0
	defaultBandRelative  = 0.2
	defaultMaxDutyBlocks = 2
	defaultSimTrials     = 1
)

func main() {
	os.Exit(run())
}

func run() int {
	soldiers := flag.Int("x", 0, "Number of soldiers (dynamic ids s0..s{n-1})")
	soldiersLong := flag.Int("soldiers", 0, "Alias for -x")
	slots := flag.Int("y", 0, "Concurrent slots per block (must match zones YAML slots list length)")
	slotsLong := flag.Int("slots", 0, "Alias for -y")
	days := flag.Int("d", 0, "Simulation days")
	daysLong := flag.Int("days", 0, "Alias for -d")
	zonesPath := flag.String("zones", "", "Zones YAML (schema v2); default zones.yaml, or scenario zones.file")
	scenarioPath := flag.String("scenario", "", "Scenario YAML (testdata/scenarios/*.yaml): sets zones, days, seed, status")
	anchorDate := flag.String("anchor-date", "", "Plan anchor YYYY-MM-DD (scenario status, weekday-off sim; default: scenario sim.anchor_date or 2026-05-27)")
	rosterPath := flag.String("roster", "", "Roster YAML for soldier type_code[] (UI export or legacy nested)")
	checkExpect := flag.Bool("check-expect", true, "With --scenario, fail if expect.* does not match")
	availabilityOnly := flag.Bool("availability-only", false, "With --scenario, compile availability and check expect.availability only (no schedule run)")
	shiftHours := flag.Float64("shift-hours", 0, "Calendar block hours: 2, 3, or 4 (overrides YAML)")
	minFreeHours := flag.Float64("min-consecutive-free-hours", defaultMinFreeHours, "Min consecutive free hours per soldier per day")
	minFreeShifts := flag.Int("min-free-shifts-after-duty", 0, "Rotating cooldown: min free blocks after duty")
	bandRelative := flag.Float64("band-relative", defaultBandRelative, "hybrid_rel band slack R")
	maxDutyBlocks := flag.Int("max-consecutive-duty-blocks", defaultMaxDutyBlocks, "Max consecutive rotating duty blocks (0=off)")
	planDayStart := flag.String("plan-day-start", guardsched.DefaultPlanDayStart, "Plan day start HH:MM (whole hours; default 05:00)")
	seed := flag.Int64("seed", -1, "RNG seed (required if --sim-trials > 1)")
	simTrials := flag.Int("sim-trials", defaultSimTrials, "Score N seeds (S..S+N-1), replay best")
	jsonOut := flag.String("json-output", "", "Write assignments JSON to PATH (stdout if '-')")
	compareJSON := flag.String("compare-json", "", "Write schedule-compare matrix JSON (Python parity format; stdout if '-')")
	hot := flag.Bool("hot", false, "Production-style incremental sim: per-day PlanDoc in checkpoint.json")
	burstDays := flag.Int("burst-days", 1, "With -hot: calendar days per save/load burst")
	quiet := flag.Bool("quiet", false, "Only print JSON/errors")
	rulesPath := flag.String("rules", "", "Expert rules text file (compact one-line-per-rule format)")
	forceRules := flag.Bool("force-rules", false, "Hard force mode for expert force: rules")
	flag.Parse()

	nSoldiers := *soldiers
	if nSoldiers <= 0 {
		nSoldiers = *soldiersLong
	}
	nSlots := *slots
	if nSlots <= 0 {
		nSlots = *slotsLong
	}
	nDays := *days
	if nDays <= 0 {
		nDays = *daysLong
	}
	zonesFile := *zonesPath

	var sc *guardsched.Scenario
	var avail guardsched.AvailabilityChecker
	var soldiersByDay map[string]any

	if *scenarioPath != "" {
		var err error
		sc, err = guardsched.LoadScenarioFile(*scenarioPath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "error: scenario: %v\n", err)
			return 2
		}
		if zonesFile == "" {
			if sc.IsStatusOnly() {
				zonesFile = "zones.yaml"
			} else {
				zonesFile, err = guardsched.ResolveZonesPath(*scenarioPath, sc.Zones.File)
				if err != nil {
					fmt.Fprintf(os.Stderr, "error: %v\n", err)
					return 2
				}
			}
		}
		if nDays < 1 {
			if sc.Sim.Days > 0 {
				nDays = sc.Sim.Days
			}
		}
		if nSlots < 1 && sc.Zones.SlotsPerBlock > 0 {
			nSlots = sc.Zones.SlotsPerBlock
		}
		if nSoldiers < 1 {
			nSoldiers = sc.InferSoldierCount(12)
		}
	} else if zonesFile == "" {
		zonesFile = "zones.yaml"
	}

	if nSoldiers < 1 {
		fmt.Fprintln(os.Stderr, "error: -x/--soldiers must be >= 1 (or use --scenario)")
		return 2
	}
	if nDays < 1 {
		fmt.Fprintln(os.Stderr, "error: -d/--days must be >= 1 (or use --scenario)")
		return 2
	}
	if *hot && *burstDays < 1 {
		fmt.Fprintln(os.Stderr, "error: -burst-days must be >= 1 with -hot")
		return 2
	}

	raw, err := os.ReadFile(zonesFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: read zones: %v\n", err)
		return 2
	}

	var slotsArg *int
	if nSlots > 0 {
		slotsArg = &nSlots
	}
	slotsEff, err := guardsched.ResolveSlotsPerBlock(slotsArg, raw, filepath.Base(zonesFile))
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		return 2
	}
	if slotsEff < 1 {
		fmt.Fprintln(os.Stderr, "error: need positive slots count")
		return 2
	}
	if nSoldiers < slotsEff {
		fmt.Fprintf(os.Stderr, "error: need at least %d soldiers for %d slots (have %d)\n", slotsEff, slotsEff, nSoldiers)
		return 2
	}

	var shiftOverride *float64
	if *shiftHours > 0 {
		sh := *shiftHours
		if err := guardsched.ValidateShiftHours(sh); err != nil {
			fmt.Fprintf(os.Stderr, "error: %v\n", err)
			return 2
		}
		shiftOverride = &sh
	}

	zc, err := guardsched.LoadZoneConfigYAML(raw, slotsEff, shiftOverride)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: load zones: %v\n", err)
		return 2
	}

	blocksPD, err := guardsched.CalendarBlocksPerDaySafe(zc.ShiftHours)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		return 2
	}

	planDayStartStr := *planDayStart
	if sc != nil && strings.TrimSpace(sc.Sim.PlanDayStart) != "" {
		planDayStartStr = sc.Sim.PlanDayStart
	}

	var seedPtr *int64
	if *seed >= 0 {
		s := *seed
		seedPtr = &s
	} else if sc != nil && sc.Sim.Seed != 0 {
		s := sc.Sim.Seed
		seedPtr = &s
	}
	if *simTrials > 1 && seedPtr == nil {
		fmt.Fprintln(os.Stderr, "error: --sim-trials > 1 requires --seed")
		return 2
	}

	planStartHour, err := guardsched.ParsePlanDayStart(planDayStartStr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		return 2
	}

	roster := guardsched.Roster(nSoldiers)
	var anchorPtr *time.Time
	var typeCodes []string
	var platoonCodes []string

	if sc != nil {
		anchor, err := resolveAnchor(sc, *anchorDate)
		if err != nil {
			fmt.Fprintf(os.Stderr, "error: %v\n", err)
			return 2
		}
		if sc.IsStatusOnly() {
			if strings.TrimSpace(sc.Sim.PlanDayStart) == "" {
				sc.Sim.PlanDayStart = planDayStartStr
			}
			if sc.Sim.Days < 1 {
				sc.Sim.Days = nDays
			}
		}
		if err := sc.ResolveTimes(anchor); err != nil {
			fmt.Fprintf(os.Stderr, "error: scenario times: %v\n", err)
			return 2
		}
		chk, err := sc.BuildChecker(roster)
		if err != nil {
			fmt.Fprintf(os.Stderr, "error: %v\n", err)
			return 2
		}
		if len(sc.Resolved) > 0 {
			avail = chk
		}
		soldiersByDay = compileSoldiersJSON(chk, anchor, nDays, planStartHour)
		if *checkExpect {
			if err := sc.CheckExpectations(chk, nil, roster); err != nil {
				fmt.Fprintf(os.Stderr, "error: scenario expect (availability): %v\n", err)
				return 1
			}
		}
		if !*quiet {
			fmt.Fprintf(os.Stderr, "Scenario: %s  anchor=%s  status_rows=%d\n",
				sc.Name, anchor.Format("2006-01-02"), len(sc.Resolved))
		}
		if *availabilityOnly {
			if !*quiet {
				fmt.Fprintln(os.Stderr, "availability-only: OK")
				b, _ := json.MarshalIndent(soldiersByDay, "", "  ")
				fmt.Println(string(b))
			}
			return 0
		}
		anchorPtr = &anchor
	} else if strings.TrimSpace(*anchorDate) != "" {
		t, err := time.Parse("2006-01-02", strings.TrimSpace(*anchorDate))
		if err != nil {
			fmt.Fprintf(os.Stderr, "error: invalid --anchor-date: %v\n", err)
			return 2
		}
		a := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
		anchorPtr = &a
	} else if *hot {
		a := time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)
		anchorPtr = &a
	}

	if strings.TrimSpace(*rosterPath) != "" {
		rosterRaw, err := os.ReadFile(*rosterPath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "error: read roster: %v\n", err)
			return 2
		}
		typeCodes, err = guardsched.LoadRosterTypeCodesYAML(rosterRaw, roster)
		if err != nil {
			fmt.Fprintf(os.Stderr, "error: roster types: %v\n", err)
			return 2
		}
		platoonCodes, err = guardsched.LoadRosterPlatoonCodesYAML(rosterRaw, roster)
		if err != nil {
			fmt.Fprintf(os.Stderr, "error: roster platoons: %v\n", err)
			return 2
		}
		if anchorPtr != nil {
			statusEntries, err := guardsched.LoadRosterStatusYAML(rosterRaw)
			if err != nil {
				fmt.Fprintf(os.Stderr, "error: roster status: %v\n", err)
				return 2
			}
			if len(statusEntries) > 0 {
				avail = guardsched.BuildRosterAvailabilityChecker(
					*anchorPtr, planStartHour, roster, statusEntries, nDays,
				)
				if !*quiet {
					fmt.Fprintf(os.Stderr, "Roster status: %d blocking entries (anchor=%s)\n",
						len(statusEntries), anchorPtr.Format("2006-01-02"))
				}
			}
		}
	}

	if !*quiet {
		fmt.Fprintf(os.Stderr, "Soldiers: %d (%s .. %s)\n", nSoldiers, "s0", fmt.Sprintf("s%d", nSoldiers-1))
		if nSlots > 0 {
			fmt.Fprintf(os.Stderr, "Concurrent slots: %d (-y)\n", slotsEff)
		} else {
			fmt.Fprintf(os.Stderr, "Concurrent slots: %d (from %s)\n", slotsEff, filepath.Base(zonesFile))
		}
		fmt.Fprintf(os.Stderr, "Days: %d  shift_hours: %.0f  blocks/day: %d\n", nDays, zc.ShiftHours, blocksPD)
	}

	keys := guardsched.SoldierKeys(nSoldiers)

	var recs []*guardsched.AssignmentRecord
	var stats *guardsched.SimulationStats
	var meta map[string]any
	if *hot {
		if anchorPtr == nil {
			fmt.Fprintln(os.Stderr, "error: -hot requires -anchor-date or --scenario")
			return 2
		}
		recs, stats, meta, err = guardsched.RunSimulationHot(
			guardsched.DefaultHotStatePath(),
			zc, nSoldiers, nDays, *burstDays, *simTrials, seedPtr,
			*minFreeHours, *maxDutyBlocks, *minFreeShifts, *bandRelative,
			planStartHour, avail, *anchorPtr, typeCodes, platoonCodes,
		)
		if !*quiet {
			fmt.Fprintf(os.Stderr, "Wrote hot store: %s\n", guardsched.DefaultHotStatePath())
		}
	} else {
		var customRules *guardsched.CustomRuleSet
		if *rulesPath != "" {
			raw, rerr := os.ReadFile(*rulesPath)
			if rerr != nil {
				fmt.Fprintf(os.Stderr, "error: rules file: %v\n", rerr)
				return 2
			}
			customRules, rerr = guardsched.ParseRulesText(string(raw), zc, keys, *forceRules)
			if rerr != nil {
				fmt.Fprintf(os.Stderr, "error: parse rules: %v\n", rerr)
				return 2
			}
		}
		recs, stats, meta, err = guardsched.RunSimulationBestOfZoneConfig(
			zc, nSoldiers, nDays, *simTrials, seedPtr,
			*minFreeHours, true, 0,
			*maxDutyBlocks, *minFreeShifts, *bandRelative,
			planStartHour, avail, anchorPtr, typeCodes, platoonCodes, customRules,
		)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: schedule: %v\n", err)
		return 1
	}

	if sc != nil && *checkExpect {
		chk, _ := sc.BuildChecker(roster)
		if err := sc.CheckExpectations(chk, recs, roster); err != nil {
			fmt.Fprintf(os.Stderr, "error: scenario expect: %v\n", err)
			return 1
		}
		if !*quiet {
			fmt.Fprintln(os.Stderr, "Scenario expectations: OK")
		}
	}

	if *compareJSON != "" {
		extra := map[string]any{
			"band_relative":               *bandRelative,
			"min_consecutive_free_hours":  *minFreeHours,
			"min_free_shifts_after_duty":  *minFreeShifts,
			"max_consecutive_duty_blocks": *maxDutyBlocks,
			"sim_trials":                  *simTrials,
			"trial_seed":                  meta["trial_seed"],
			"trial_index":                 meta["trial_index"],
			"zones_path":                  zonesFile,
			"source":                      "go",
		}
		if sc != nil {
			extra["scenario"] = sc.Name
		}
		cmpDoc := guardsched.ScheduleCompareFromRecords(
			zc, recs, nDays, blocksPD, slotsEff, nSoldiers, zc.ShiftHours, extra,
		)
		payload, err := guardsched.MarshalScheduleJSON(cmpDoc)
		if err != nil {
			fmt.Fprintf(os.Stderr, "error: json: %v\n", err)
			return 2
		}
		switch *compareJSON {
		case "-":
			fmt.Println(string(payload))
		default:
			if err := os.WriteFile(*compareJSON, payload, 0o644); err != nil {
				fmt.Fprintf(os.Stderr, "error: write %s: %v\n", *compareJSON, err)
				return 2
			}
			if !*quiet {
				fmt.Fprintf(os.Stderr, "Wrote compare JSON %s\n", *compareJSON)
			}
		}
		return 0
	}

	assignJSON := guardsched.AssignmentRecordsToJSON(recs, keys)

	outDoc := map[string]any{
		"ok":             true,
		"zones":          filepath.Base(zonesFile),
		"soldiers":       nSoldiers,
		"soldier_ids":    keys,
		"slots":          slotsEff,
		"days":           nDays,
		"shift_hours":    zc.ShiftHours,
		"blocks_per_day": blocksPD,
		"count":          len(assignJSON),
		"assignments":    assignJSON,
		"meta": map[string]any{
			"sim_trials":                     *simTrials,
			"trial":                          meta,
			"min_consecutive_free_hours":     *minFreeHours,
			"min_free_shifts_after_duty":     *minFreeShifts,
			"band_relative":                  *bandRelative,
			"max_consecutive_duty_blocks":    *maxDutyBlocks,
			"shift_cooldown_exclusions":      stats.ShiftCooldownExclusions,
			"shift_cooldown_pool_iterations": stats.ShiftCooldownPoolIterations,
			"plan_day_start":                 planDayStartStr,
		},
	}
	if sc != nil {
		outDoc["scenario"] = sc.Name
		outDoc["soldiers_availability"] = soldiersByDay
	}
	payload, err := json.MarshalIndent(outDoc, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: json: %v\n", err)
		return 2
	}

	if !*quiet {
		fmt.Fprintf(os.Stderr, "OK: %d assignments (trial_seed=%v fairness_score=%v)\n",
			len(assignJSON), meta["trial_seed"], meta["fairness_score"])
	}

	switch *jsonOut {
	case "":
		if !*quiet {
			fmt.Println(string(payload))
		}
	case "-":
		fmt.Println(string(payload))
	default:
		if err := os.WriteFile(*jsonOut, payload, 0o644); err != nil {
			fmt.Fprintf(os.Stderr, "error: write %s: %v\n", *jsonOut, err)
			return 2
		}
		if !*quiet {
			fmt.Fprintf(os.Stderr, "Wrote %s\n", *jsonOut)
		}
	}
	return 0
}

func resolveAnchor(sc *guardsched.Scenario, flagAnchor string) (time.Time, error) {
	if strings.TrimSpace(flagAnchor) != "" {
		t, err := time.Parse("2006-01-02", flagAnchor)
		if err != nil {
			return time.Time{}, fmt.Errorf("invalid --anchor-date: %w", err)
		}
		return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC), nil
	}
	return sc.DefaultAnchorDate()
}

func compileSoldiersJSON(chk *availability.Checker, anchor time.Time, days, planStartHour int) map[string]any {
	out := make(map[string]any, days)
	for d := 0; d < days; d++ {
		cal := anchor.AddDate(0, 0, d).Format("2006-01-02")
		day := chk.CompileDay(d)
		out[cal] = map[string]any{
			"avail_full":     day.AvailFull,
			"avail_partial":  day.AvailPartial,
			"avail_absent":   day.AvailAbsent,
			"summary":        day.Summary,
		}
	}
	return out
}


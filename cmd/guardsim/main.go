// guardsim — CLI for guard zone scheduling (parity with guard_scheduler_sim.py).
//
// Example:
//
//	go run ./cmd/guardsim -x 12 -y 4 -d 1 --zones zones_s1.yaml \
//	  --shift-hours 4 --min-free-shifts-after-duty 2 --min-consecutive-free-hours 6 --band-relative 0.2
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"guard/guardsched"
)

const (
	defaultMinFreeHours     = 6.0
	defaultBandRelative     = 0.2
	defaultMaxDutyBlocks    = 2
	defaultSimTrials        = 1
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
	zonesPath := flag.String("zones", "zones.yaml", "Zones YAML (schema v2)")
	shiftHours := flag.Float64("shift-hours", 0, "Calendar block hours: 2, 3, or 4 (overrides YAML)")
	minFreeHours := flag.Float64("min-consecutive-free-hours", defaultMinFreeHours, "Min consecutive free hours per soldier per day")
	minFreeShifts := flag.Int("min-free-shifts-after-duty", 0, "Rotating cooldown: min free blocks after duty")
	bandRelative := flag.Float64("band-relative", defaultBandRelative, "hybrid_rel band slack R")
	maxDutyBlocks := flag.Int("max-consecutive-duty-blocks", defaultMaxDutyBlocks, "Max consecutive rotating duty blocks (0=off)")
	seed := flag.Int64("seed", -1, "RNG seed (required if --sim-trials > 1)")
	simTrials := flag.Int("sim-trials", defaultSimTrials, "Score N seeds (S..S+N-1), replay best")
	jsonOut := flag.String("json-output", "", "Write assignments JSON to PATH (stdout if '-')")
	compareJSON := flag.String("compare-json", "", "Write schedule-compare matrix JSON (Python parity format; stdout if '-')")
	quiet := flag.Bool("quiet", false, "Only print JSON/errors")
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
	if nSoldiers < 1 {
		fmt.Fprintln(os.Stderr, "error: -x/--soldiers must be >= 1")
		return 2
	}
	if nDays < 1 {
		fmt.Fprintln(os.Stderr, "error: -d/--days must be >= 1")
		return 2
	}

	raw, err := os.ReadFile(*zonesPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: read zones: %v\n", err)
		return 2
	}

	var slotsArg *int
	if nSlots > 0 {
		slotsArg = &nSlots
	}
	slotsEff, err := guardsched.ResolveSlotsPerBlock(slotsArg, raw, filepath.Base(*zonesPath))
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

	var seedPtr *int64
	if *seed >= 0 {
		s := *seed
		seedPtr = &s
	}
	if *simTrials > 1 && seedPtr == nil {
		fmt.Fprintln(os.Stderr, "error: --sim-trials > 1 requires --seed")
		return 2
	}

	if !*quiet {
		fmt.Fprintf(os.Stderr, "Soldiers: %d (%s .. %s)\n", nSoldiers, "s0", fmt.Sprintf("s%d", nSoldiers-1))
		if nSlots > 0 {
			fmt.Fprintf(os.Stderr, "Concurrent slots: %d (-y)\n", slotsEff)
		} else {
			fmt.Fprintf(os.Stderr, "Concurrent slots: %d (from %s)\n", slotsEff, filepath.Base(*zonesPath))
		}
		fmt.Fprintf(os.Stderr, "Days: %d  shift_hours: %.0f  blocks/day: %d\n", nDays, zc.ShiftHours, blocksPD)
	}

	recs, stats, meta, err := guardsched.RunSimulationBestOfZoneConfig(
		zc, nSoldiers, nDays, *simTrials, seedPtr,
		*minFreeHours, true, 0,
		*maxDutyBlocks, *minFreeShifts, *bandRelative,
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: schedule: %v\n", err)
		return 1
	}

	if *compareJSON != "" {
		extra := map[string]any{
			"band_relative":              *bandRelative,
			"min_consecutive_free_hours": *minFreeHours,
			"min_free_shifts_after_duty": *minFreeShifts,
			"max_consecutive_duty_blocks": *maxDutyBlocks,
			"sim_trials":                 *simTrials,
			"trial_seed":                 meta["trial_seed"],
			"trial_index":                meta["trial_index"],
			"zones_path":                 *zonesPath,
			"source":                     "go",
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

	keys := guardsched.SoldierKeys(nSoldiers)
	assignJSON := guardsched.AssignmentRecordsToJSON(recs, keys)

	outDoc := map[string]any{
		"ok":          true,
		"zones":       filepath.Base(*zonesPath),
		"soldiers":    nSoldiers,
		"soldier_ids": keys,
		"slots":       slotsEff,
		"days":        nDays,
		"shift_hours": zc.ShiftHours,
		"blocks_per_day": blocksPD,
		"count":       len(assignJSON),
		"assignments": assignJSON,
		"meta": map[string]any{
			"sim_trials":                     *simTrials,
			"trial":                          meta,
			"min_consecutive_free_hours":     *minFreeHours,
			"min_free_shifts_after_duty":     *minFreeShifts,
			"band_relative":                  *bandRelative,
			"max_consecutive_duty_blocks":    *maxDutyBlocks,
			"shift_cooldown_exclusions":      stats.ShiftCooldownExclusions,
			"shift_cooldown_pool_iterations": stats.ShiftCooldownPoolIterations,
		},
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

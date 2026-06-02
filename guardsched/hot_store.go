package guardsched

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"time"

	"guard/internal/model"
)

const defaultHotStatePath = "checkpoint.json"

// DefaultHotStatePath returns the default hot store file path.
func DefaultHotStatePath() string {
	return defaultHotStatePath
}

// HotStore is a date-keyed map of PlanDoc JSON (production DB shape).
type HotStore map[string]model.PlanDoc

// ClearHotStore removes the hot store file if present.
func ClearHotStore(path string) error {
	if path == "" {
		path = defaultHotStatePath
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// ReadHotStore loads the date-keyed plan map.
func ReadHotStore(path string) (HotStore, error) {
	if path == "" {
		path = defaultHotStatePath
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return HotStore{}, nil
		}
		return nil, err
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, err
	}
	out := make(HotStore, len(m))
	for k, v := range m {
		var doc model.PlanDoc
		if err := json.Unmarshal(v, &doc); err != nil {
			return nil, fmt.Errorf("hot store %s: %w", k, err)
		}
		out[k] = doc
	}
	return out, nil
}

// WriteHotStore writes the date-keyed plan map.
func WriteHotStore(path string, store HotStore) error {
	if path == "" {
		path = defaultHotStatePath
	}
	raw, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0o644)
}

// HotHistory is replayed prefix + continuation from the last saved day.
type HotHistory struct {
	Prefix       []*AssignmentRecord
	PrefixDays   int
	Continuation *ContinuationSnapshot
	LastDate     string
}

// LoadHotHistory replays saved plan days (mirrors loadVerifiedHistoryPrefix).
func LoadHotHistory(path string, soldierKeys []string, expectShiftHours float64) (*HotHistory, error) {
	store, err := ReadHotStore(path)
	if err != nil {
		return nil, err
	}
	if len(store) == 0 {
		return &HotHistory{}, nil
	}
	dates := make([]string, 0, len(store))
	for d := range store {
		dates = append(dates, d)
	}
	sort.Strings(dates)

	h := &HotHistory{}
	var lastPlan model.PlanDoc
	for i, cal := range dates {
		plan := store[cal]
		if plan.ShiftHours != 0 && plan.ShiftHours != expectShiftHours {
			return nil, fmt.Errorf("plan %s shift_hours=%g expected %g", cal, plan.ShiftHours, expectShiftHours)
		}
		recs := RecordsFromAssignmentJSON(plan.Assignments, soldierKeys)
		for _, rec := range recs {
			if rec == nil {
				continue
			}
			cp := *rec
			cp.Day = i
			h.Prefix = append(h.Prefix, &cp)
		}
		lastPlan = plan
		h.LastDate = cal
	}
	h.PrefixDays = len(dates)
	if lastPlan.Continuation != nil {
		cont, err := continuationFromPlan(lastPlan.Continuation)
		if err != nil {
			return nil, err
		}
		h.Continuation = cont
	}
	return h, nil
}

func continuationFromPlan(c *model.SimContinuation) (*ContinuationSnapshot, error) {
	if c == nil || c.FormatVersion == 0 {
		return nil, nil
	}
	out := &ContinuationSnapshot{
		FormatVersion: c.FormatVersion,
		NumDays:       c.NumDays,
		SuffixNonrot:  c.SuffixNonrot,
		TargetHorizon: c.TargetHorizon,
		Seed:          c.Seed,
	}
	if c.RNGState != nil {
		b, err := json.Marshal(c.RNGState)
		if err != nil {
			return nil, err
		}
		var rng RNGStateJSON
		if err := json.Unmarshal(b, &rng); err != nil {
			return nil, err
		}
		out.RNGState = &rng
	}
	return out, nil
}

func continuationToPlan(c *ContinuationSnapshot) *model.SimContinuation {
	if c == nil {
		return nil
	}
	out := &model.SimContinuation{
		FormatVersion: c.FormatVersion,
		NumDays:       c.NumDays,
		SuffixNonrot:  c.SuffixNonrot,
		TargetHorizon: c.TargetHorizon,
		Seed:          c.Seed,
	}
	if c.RNGState != nil {
		b, _ := json.Marshal(c.RNGState)
		_ = json.Unmarshal(b, &out.RNGState)
	}
	return out
}

// AppendHotSegment writes new calendar-day PlanDocs; continuation on the last new day only.
func AppendHotSegment(
	path string,
	anchor time.Time,
	shiftHours float64,
	segment []*AssignmentRecord,
	dayOffset int,
	cont *ContinuationSnapshot,
	soldierKeys []string,
) error {
	store, err := ReadHotStore(path)
	if err != nil {
		return err
	}
	if store == nil {
		store = HotStore{}
	}
	dayPlans, err := splitSegmentByDate(anchor, dayOffset, shiftHours, segment, soldierKeys)
	if err != nil {
		return err
	}
	for i, dp := range dayPlans {
		cal := dp.TsDate.Format("2006-01-02")
		if _, ok := store[cal]; ok {
			return fmt.Errorf("hot store already has plan for %s", cal)
		}
		if i == len(dayPlans)-1 && cont != nil {
			dp.Plan.Continuation = continuationToPlan(cont)
		}
		store[cal] = dp.Plan
	}
	return WriteHotStore(path, store)
}

func splitSegmentByDate(
	anchor time.Time,
	dayOffset int,
	shiftHours float64,
	segment []*AssignmentRecord,
	soldierKeys []string,
) ([]model.ScheduleDay, error) {
	byDate := map[string][]map[string]any{}
	for _, a := range segment {
		if a == nil {
			continue
		}
		cal := anchor.AddDate(0, 0, dayOffset+int(a.Day)).Format("2006-01-02")
		cp := *a
		cp.Day = 0
		row := assignmentRecordToMap(&cp, soldierKeys)
		byDate[cal] = append(byDate[cal], row)
	}
	dates := make([]string, 0, len(byDate))
	for d := range byDate {
		dates = append(dates, d)
	}
	sort.Strings(dates)
	out := make([]model.ScheduleDay, 0, len(dates))
	for _, cal := range dates {
		ts, err := time.Parse("2006-01-02", cal)
		if err != nil {
			return nil, err
		}
		ts = time.Date(ts.Year(), ts.Month(), ts.Day(), 0, 0, 0, 0, time.UTC)
		out = append(out, model.ScheduleDay{
			TsDate: ts,
			Plan: model.PlanDoc{
				FormatVersion: model.PlanFormatVersion,
				AnchorDate:    cal,
				Days:          1,
				ShiftHours:    shiftHours,
				Assignments:   byDate[cal],
			},
		})
	}
	return out, nil
}

func assignmentRecordToMap(a *AssignmentRecord, keys []string) map[string]any {
	rows := AssignmentRecordsToJSON([]*AssignmentRecord{a}, keys)
	if len(rows) == 0 {
		return map[string]any{}
	}
	rows[0]["day"] = 0
	return rows[0]
}

// RunSimulationHot runs incremental production-style simulation into path.
func RunSimulationHot(
	path string,
	zc *ZoneConfig,
	numSoldiers, totalDays, burstDays, simTrials int,
	baseSeed *int64,
	minFreeHours float64,
	maxDutyBlocks, minFreeShifts int,
	bandRel float64,
	planStartHour int,
	avail AvailabilityChecker,
	anchor time.Time,
	typeCodes, platoonCodes []string,
) ([]*AssignmentRecord, *SimulationStats, map[string]any, error) {
	if totalDays < 1 {
		return nil, nil, nil, fmt.Errorf("total_days must be >= 1")
	}
	if burstDays < 1 {
		return nil, nil, nil, fmt.Errorf("burst_days must be >= 1")
	}
	keys := SoldierKeys(numSoldiers)
	if err := ClearHotStore(path); err != nil {
		return nil, nil, nil, err
	}

	var lastRecs []*AssignmentRecord
	var lastStats *SimulationStats
	var lastMeta map[string]any
	savedDays := 0

	for savedDays < totalDays {
		chunk := burstDays
		if remain := totalDays - savedDays; remain < chunk {
			chunk = remain
		}
		prefixDays := savedDays

		if prefixDays == 0 {
			if simTrials > 1 && baseSeed == nil {
				return nil, nil, nil, fmt.Errorf("sim_trials > 1 requires seed for hot")
			}
			var seedUsed int64
			if baseSeed != nil {
				seedUsed = *baseSeed
			}
			rng := NewPyRandom(seedUsed)
			cold, err := RunSimulationZoneConfigWithContinuation(
				zc, numSoldiers, chunk, chunk, rng,
				minFreeHours, true, 0, maxDutyBlocks, minFreeShifts, bandRel,
				planStartHour, avail, &anchor, typeCodes, platoonCodes, baseSeed,
			)
			if err != nil {
				return nil, nil, nil, err
			}
			lastRecs = cold.Records
			lastStats = cold.Stats
			segment := filterDayRange(cold.Records, 0, chunk)
			if err := AppendHotSegment(path, anchor, zc.ShiftHours, segment, 0, cold.Continuation, keys); err != nil {
				return nil, nil, nil, err
			}
			lastMeta = map[string]any{"trial_seed": seedUsed, "trials_run": 1}
		} else {
			if simTrials > 1 {
				return nil, nil, nil, fmt.Errorf("hot extend requires sim_trials 1")
			}
			hist, err := LoadHotHistory(path, keys, zc.ShiftHours)
			if err != nil {
				return nil, nil, nil, err
			}
			if hist.PrefixDays != prefixDays {
				return nil, nil, nil, fmt.Errorf("hot store days %d != prefix %d", hist.PrefixDays, prefixDays)
			}
			var witness *ExtendWitness
			if hist.Continuation != nil && hist.Continuation.RNGState != nil {
				witness, _, err = ExtendWitnessFromContinuation(hist.Continuation, hist.Prefix, keys)
				if err != nil {
					return nil, nil, nil, err
				}
			}
			var seedUsed int64
			if baseSeed != nil {
				seedUsed = *baseSeed
			}
			recs, stats, cont, _, err := RunSimulationBestOfZoneConfigExtendWitness(
				zc, numSoldiers, prefixDays, chunk, 1, hist.Prefix, &seedUsed,
				minFreeHours, true, 0, maxDutyBlocks, minFreeShifts, bandRel,
				planStartHour, avail, &anchor, typeCodes, platoonCodes, witness,
			)
			if err != nil {
				return nil, nil, nil, err
			}
			norm := normalizeExtendNewRecords(recs, prefixDays)
			lastRecs = append(append([]*AssignmentRecord{}, hist.Prefix...), norm...)
			lastStats = stats
			segment := filterDayRange(norm, prefixDays, prefixDays+chunk)
			if err := AppendHotSegment(path, anchor, zc.ShiftHours, segment, prefixDays, cont, keys); err != nil {
				return nil, nil, nil, err
			}
			lastMeta = map[string]any{"trial_seed": seedUsed, "trials_run": 1}
		}
		savedDays += chunk
	}

	meta := map[string]any{
		"trials_run":     1,
		"trial_index":    0,
		"trial_seed":     lastMeta["trial_seed"],
		"fairness_score": FairnessScoreFromAssignments(lastRecs, numSoldiers),
		"hot_days_saved": savedDays,
	}
	return lastRecs, lastStats, meta, nil
}

func filterDayRange(recs []*AssignmentRecord, fromDay, toDay int) []*AssignmentRecord {
	var out []*AssignmentRecord
	for _, a := range recs {
		if a == nil {
			continue
		}
		if a.Day >= fromDay && a.Day < toDay {
			cp := *a
			cp.Day -= fromDay
			out = append(out, &cp)
		}
	}
	return out
}

// normalizeExtendNewRecords maps extend output to absolute plan days.
// Non-rotating rows use plan-relative days 0..extendDays-1; rotating rows use absolute days.
func normalizeExtendNewRecords(recs []*AssignmentRecord, prefixDays int) []*AssignmentRecord {
	out := make([]*AssignmentRecord, 0, len(recs))
	for _, a := range recs {
		if a == nil {
			continue
		}
		cp := *a
		kind := cp.Kind
		if kind == "" {
			kind = "rotating"
		}
		if kind != "rotating" && cp.Day < prefixDays {
			cp.Day += prefixDays
		}
		out = append(out, &cp)
	}
	return out
}

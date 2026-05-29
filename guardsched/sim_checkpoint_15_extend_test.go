package guardsched

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"slices"
	"testing"
)

// Mirrors tests/test_checkpoint_15_extend_5.py (15-day checkpoint → load → extend 5).

const (
	ckptPrefixDays = 15
	ckptExtendDays = 5
	ckptTotalDays  = ckptPrefixDays + ckptExtendDays
	ckptSoldiers   = 12
	ckptSlots      = 4
	ckptSeed       = 12345
)

func assignmentRecordSig(recs []*AssignmentRecord, dayMin, reindex int) []string {
	var out []string
	for _, a := range recs {
		if a == nil || a.Day < dayMin {
			continue
		}
		k := a.Kind
		if k == "" {
			k = "rotating"
		}
		out = append(out, fmt.Sprintf("%d,%d,%d,%d,%s", a.Day-reindex, a.CalendarBlock, a.Slot, a.SoldierIdx, k))
	}
	sort.Strings(out)
	return out
}

func ckptSimExtend(
	zone *ZoneConfig,
	prefix []*AssignmentRecord,
	prefixDays, extendDays int,
	seed int64,
) ([]*AssignmentRecord, error) {
	recs, _, err := RunSimulationZoneConfigExtend(
		zone, ckptSoldiers, prefixDays, extendDays, prefix, NewPyRandom(seed),
		6, true, 0, 2, 2, 0.2,
		5, nil, nil, nil,
	)
	return recs, err
}

func ckptSimCold(zone *ZoneConfig, days int, seed int64) ([]*AssignmentRecord, error) {
	recs, _, err := RunSimulationZoneConfig(
		zone, ckptSoldiers, days, NewPyRandom(seed),
		6, true, 0, 2, 2, 0.2,
		5, nil, nil, nil,
	)
	return recs, err
}

// extend segment only (days 0..extendDays-1).
func extendNew5Sig(recs []*AssignmentRecord) []string {
	return assignmentRecordSig(recs, 0, 0)
}

func prefixSig(recs []*AssignmentRecord, prefixDays int) []string {
	return assignmentRecordSig(recs, 0, 0)
}

func assignmentRecordToMap(a *AssignmentRecord) map[string]any {
	k := a.Kind
	if k == "" {
		k = "rotating"
	}
	m := map[string]any{
		"day":             a.Day,
		"calendar_block":  a.CalendarBlock,
		"start_hour":      a.StartHour,
		"slot":            a.Slot,
		"soldier_idx":     a.SoldierIdx,
		"loc_i":           a.LocI,
		"time_j":          a.TimeJ,
		"weight":          a.Weight,
		"raw_hours":       a.RawHours,
		"kind":            k,
		"rowspan":         a.Rowspan,
		"win_start_block": a.WinStartBlock,
		"win_end_block":   a.WinEndBlock,
	}
	if a.WindowName != "" {
		m["window_name"] = a.WindowName
	}
	if a.LinearBusySpanBlocks != 0 {
		m["linear_busy_span_blocks"] = a.LinearBusySpanBlocks
	}
	return m
}

func writeCheckpointJSON(t *testing.T, path string, prefix []*AssignmentRecord, numDays, blocksPD, slots int) {
	t.Helper()
	assigns := make([]map[string]any, len(prefix))
	for i, a := range prefix {
		assigns[i] = assignmentRecordToMap(a)
	}
	doc := map[string]any{
		"format_version":  1,
		"num_days":        numDays,
		"blocks_per_day":  blocksPD,
		"slots_per_block": slots,
		"assignments":     assigns,
	}
	raw, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatal(err)
	}
}

func loadCheckpointAssignments(t *testing.T, path string) ([]*AssignmentRecord, int) {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var ckpt struct {
		Assignments []map[string]any `json:"assignments"`
		NumDays     int              `json:"num_days"`
	}
	if err := json.Unmarshal(raw, &ckpt); err != nil {
		t.Fatal(err)
	}
	keys := SoldierKeys(ckptSoldiers)
	return RecordsFromAssignmentJSON(ckpt.Assignments, keys), ckpt.NumDays
}

func expectedRotatingAssignmentCount(zone *ZoneConfig, days int) int {
	B, err := CalendarBlocksPerDaySafe(zone.ShiftHours)
	if err != nil {
		panic(err)
	}
	return days * B * zone.SlotsPerBlock()
}

func TestCheckpoint15SaveLoadExtend5MatchesDirectExtend(t *testing.T) {
	zone := loadRotatingOnlyZone(t, ckptSlots)
	prefix, err := ckptSimCold(zone, ckptPrefixDays, ckptSeed)
	if err != nil {
		t.Fatal(err)
	}
	B, _ := CalendarBlocksPerDaySafe(zone.ShiftHours)
	if len(prefix) != expectedRotatingAssignmentCount(zone, ckptPrefixDays) {
		t.Fatalf("prefix count: got %d want %d", len(prefix), ckptPrefixDays*B*ckptSlots)
	}

	dir := t.TempDir()
	ckptPath := filepath.Join(dir, "checkpoint_15d.json")
	writeCheckpointJSON(t, ckptPath, prefix, ckptPrefixDays, B, ckptSlots)

	loaded, numDays := loadCheckpointAssignments(t, ckptPath)
	if numDays != ckptPrefixDays {
		t.Fatalf("num_days: got %d want %d", numDays, ckptPrefixDays)
	}
	if !slices.Equal(prefixSig(loaded, ckptPrefixDays), prefixSig(prefix, ckptPrefixDays)) {
		t.Fatal("loaded prefix assignments differ from in-memory prefix")
	}

	direct, err := ckptSimExtend(zone, prefix, ckptPrefixDays, ckptExtendDays, ckptSeed)
	if err != nil {
		t.Fatal(err)
	}
	fromSaved, err := ckptSimExtend(zone, loaded, ckptPrefixDays, ckptExtendDays, ckptSeed)
	if err != nil {
		t.Fatal(err)
	}
	sigDirect := extendNew5Sig(direct)
	sigSaved := extendNew5Sig(fromSaved)
	if len(sigDirect) != expectedRotatingAssignmentCount(zone, ckptExtendDays) {
		t.Fatalf("extend count: got %d want %d", len(sigDirect), expectedRotatingAssignmentCount(zone, ckptExtendDays))
	}
	if !slices.Equal(sigDirect, sigSaved) {
		t.Fatalf("direct vs load+extend mismatch (first direct=%v saved=%v)", sigDirect[0], sigSaved[0])
	}
}

func TestCheckpoint15Extend5ReproducibleFromSaved(t *testing.T) {
	zone := loadRotatingOnlyZone(t, ckptSlots)
	prefix, err := ckptSimCold(zone, ckptPrefixDays, ckptSeed)
	if err != nil {
		t.Fatal(err)
	}
	B, _ := CalendarBlocksPerDaySafe(zone.ShiftHours)
	ckptPath := filepath.Join(t.TempDir(), "checkpoint_15d.json")
	writeCheckpointJSON(t, ckptPath, prefix, ckptPrefixDays, B, ckptSlots)
	loaded, _ := loadCheckpointAssignments(t, ckptPath)

	extA, err := ckptSimExtend(zone, loaded, ckptPrefixDays, ckptExtendDays, ckptSeed)
	if err != nil {
		t.Fatal(err)
	}
	extB, err := ckptSimExtend(zone, loaded, ckptPrefixDays, ckptExtendDays, ckptSeed)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(extendNew5Sig(extA), extendNew5Sig(extB)) {
		t.Fatal("two extends from same saved checkpoint differ")
	}
}

func TestCheckpoint15Extend5MatchesGuardsimCLI(t *testing.T) {
	root := findRepoRoot(t)
	zones := filepath.Join(root, "testdata", "zones_s1_gate4.yaml")
	bin := filepath.Join(root, "bin", "guardsim")
	build := exec.Command("go", "build", "-o", bin, "./cmd/guardsim")
	build.Dir = root
	if err := build.Run(); err != nil {
		t.Fatal(err)
	}

	zone := loadRotatingOnlyZone(t, ckptSlots)
	prefix, err := ckptSimCold(zone, ckptPrefixDays, ckptSeed)
	if err != nil {
		t.Fatal(err)
	}
	B, _ := CalendarBlocksPerDaySafe(zone.ShiftHours)
	ckptPath := filepath.Join(t.TempDir(), "checkpoint_15d.json")
	writeCheckpointJSON(t, ckptPath, prefix, ckptPrefixDays, B, ckptSlots)

	inProc, err := ckptSimExtend(zone, prefix, ckptPrefixDays, ckptExtendDays, ckptSeed)
	if err != nil {
		t.Fatal(err)
	}
	pySig := extendNew5Sig(inProc)

	cli := exec.Command(bin,
		"-zones", zones,
		"-x", "12", "-y", "4",
		"-load-state", ckptPath,
		"-extend-days", "5",
		"-seed", "12345",
		"-min-consecutive-free-hours", "6",
		"-min-free-shifts-after-duty", "2",
		"-band-relative", "0.2",
		"-json-output", "-",
		"-quiet",
	)
	cli.Dir = root
	out, err := cli.Output()
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			t.Fatalf("guardsim: %v\nstderr: %s\nstdout: %s", err, ee.Stderr, out)
		}
		t.Fatal(err)
	}
	var payload struct {
		Assignments []map[string]any `json:"assignments"`
	}
	if err := json.Unmarshal(out, &payload); err != nil {
		t.Fatal(err)
	}
	keys := SoldierKeys(ckptSoldiers)
	goCLI := RecordsFromAssignmentJSON(payload.Assignments, keys)
	cliSig := extendNew5Sig(goCLI)
	if !slices.Equal(pySig, cliSig) {
		t.Fatalf("in-process extend vs guardsim CLI mismatch (first in-proc=%v cli=%v)", pySig[0], cliSig[0])
	}
}

func TestPrefixFrom20DayMatchesStandalone15Day(t *testing.T) {
	zone := loadRotatingOnlyZone(t, ckptSlots)
	cold20, err := ckptSimCold(zone, ckptTotalDays, ckptSeed)
	if err != nil {
		t.Fatal(err)
	}
	cold15, err := ckptSimCold(zone, ckptPrefixDays, ckptSeed)
	if err != nil {
		t.Fatal(err)
	}
	var prefix20 []*AssignmentRecord
	for _, a := range cold20 {
		if a.Day < ckptPrefixDays {
			prefix20 = append(prefix20, a)
		}
	}
	if !slices.Equal(prefixSig(cold15, ckptPrefixDays), prefixSig(prefix20, ckptPrefixDays)) {
		t.Fatal("first 15 days of 20-day cold run != standalone 15-day cold run")
	}
}

func TestExtend5DiffersFromCold20Tail(t *testing.T) {
	// Checkpoint extend resets RNG and uses greedy-only rotating; a single 20-day cold
	// run may differ on days 15–19 (documented parity caveat).
	zone := loadRotatingOnlyZone(t, ckptSlots)
	cold20, err := ckptSimCold(zone, ckptTotalDays, ckptSeed)
	if err != nil {
		t.Fatal(err)
	}
	cold15, err := ckptSimCold(zone, ckptPrefixDays, ckptSeed)
	if err != nil {
		t.Fatal(err)
	}
	ext, err := ckptSimExtend(zone, cold15, ckptPrefixDays, ckptExtendDays, ckptSeed)
	if err != nil {
		t.Fatal(err)
	}
	var tail20 []*AssignmentRecord
	for _, a := range cold20 {
		if a.Day >= ckptPrefixDays {
			// reindex to extend plan days 0..4
			cp := *a
			cp.Day = a.Day - ckptPrefixDays
			tail20 = append(tail20, &cp)
		}
	}
	if slices.Equal(extendNew5Sig(ext), extendNew5Sig(tail20)) {
		t.Fatal("expected extend-5 != cold-20 tail (RNG/DFS); got identical schedules")
	}
}

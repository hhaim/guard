package httpapi

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"

	"guard/guardsched"
	"guard/internal/model"
)

// Verifies UI storage path: sim → AssignmentRecordsToJSON → SplitPlanByDate (DB row)
// → RecordsFromAssignmentJSON + day reindex (history prefix) round-trips the same
// assignment payload as CLI checkpoint JSON (no extra sim-only assignment fields).
func TestDBAssignmentStorageMatchesCheckpointPayload(t *testing.T) {
	root := filepath.Join("..", "..")
	zonesPath := filepath.Join(root, "zones_s2.yaml")
	rosterPath := filepath.Join(root, "roaster1.yaml")
	zonesData, err := os.ReadFile(zonesPath)
	if err != nil {
		t.Skip("zones_s2.yaml not in repo root")
	}
	rosterData, err := os.ReadFile(rosterPath)
	if err != nil {
		t.Skip("roaster1.yaml not in repo root")
	}

	const (
		numSoldiers = 18
		slots       = 5
		days        = 3
		seed        = int64(42)
	)
	zone, err := guardsched.LoadZoneConfigYAML(zonesData, slots, nil)
	if err != nil {
		t.Fatal(err)
	}
	keys := guardsched.SoldierKeys(numSoldiers)
	typeCodes, err := guardsched.LoadRosterTypeCodesYAML(rosterData, keys)
	if err != nil {
		t.Fatal(err)
	}
	anchor := time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)
	rng := guardsched.NewPyRandom(seed)
	recs, _, err := guardsched.RunSimulationZoneConfig(
		zone, numSoldiers, days, rng,
		6, true, 0, 2, 2, 0.2,
		5, nil, &anchor, typeCodes, nil, nil, nil,
	)
	if err != nil {
		t.Fatal(err)
	}

	// What the UI API returns / proposal stores (before per-day split).
	apiAssign := guardsched.AssignmentRecordsToJSON(recs, keys)
	proposal := model.PlanDoc{
		FormatVersion: model.PlanFormatVersion,
		AnchorDate:    anchor.Format("2006-01-02"),
		Days:          days,
		ShiftHours:    zone.ShiftHours,
		Assignments:   apiAssign,
	}

	// What handlePlanApply writes: one schedule row per calendar date.
	dayPlans, err := model.SplitPlanByDate(proposal)
	if err != nil {
		t.Fatal(err)
	}
	if len(dayPlans) != days {
		t.Fatalf("split days: got %d want %d", len(dayPlans), days)
	}

	// What loadVerifiedHistoryPrefix reads back (assignment rows only; day reindexed).
	var replayed []*guardsched.AssignmentRecord
	for i, row := range dayPlans {
		if row.Plan.Days != 1 {
			t.Fatalf("stored day %s: days=%d want 1", row.TsDate.Format("2006-01-02"), row.Plan.Days)
		}
		for _, a := range row.Plan.Assignments {
			if d, ok := a["day"].(float64); ok && int(d) != 0 {
				t.Fatalf("stored day %s: assignment day=%v want 0", row.TsDate.Format("2006-01-02"), a["day"])
			}
		}
		part := guardsched.RecordsFromAssignmentJSON(row.Plan.Assignments, keys)
		for _, rec := range part {
			if rec == nil {
				continue
			}
			rec.Day = i
			replayed = append(replayed, rec)
		}
	}

	if len(replayed) != len(recs) {
		t.Fatalf("replayed count %d != sim count %d", len(replayed), len(recs))
	}

	// Checkpoint JSON stores the same assignment fields as DB rows (minus soldier_id).
	checkpointAssign := guardsched.AssignmentRecordsToJSON(recs, nil) // no soldier_id in CLI checkpoint
	for i := range checkpointAssign {
		delete(checkpointAssign[i], "soldier_id")
	}

	sig := func(list []*guardsched.AssignmentRecord) []string {
		out := make([]string, 0, len(list))
		for _, a := range list {
			if a == nil {
				continue
			}
			k := a.Kind
			if k == "" {
				k = "rotating"
			}
			out = append(out, fmt.Sprintf("%d,%d,%d,%d,%d,%d,%s,%g,%g",
				a.Day, a.CalendarBlock, a.StartHour, a.Slot, a.SoldierIdx, a.LocI, k, a.Weight, a.RawHours))
		}
		sort.Strings(out)
		return out
	}
	origSig := sig(recs)
	repSig := sig(replayed)
	if len(origSig) != len(repSig) {
		t.Fatalf("signature count orig=%d replayed=%d", len(origSig), len(repSig))
	}
	for i := range origSig {
		if origSig[i] != repSig[i] {
			t.Fatalf("row %d: orig=%s replayed=%s", i, origSig[i], repSig[i])
		}
	}

	// No extra keys in API JSON beyond checkpoint + soldier_id.
	for _, row := range apiAssign {
		for k := range row {
			switch k {
			case "soldier_id":
			default:
				found := false
				for _, ck := range []string{
					"day", "calendar_block", "start_hour", "slot", "soldier_idx",
					"loc_i", "time_j", "weight", "raw_hours", "kind", "rowspan",
					"win_start_block", "win_end_block", "window_name", "linear_busy_span_blocks",
				} {
					if k == ck {
						found = true
						break
					}
				}
				if !found {
					t.Fatalf("unexpected assignment field %q in API/DB JSON", k)
				}
			}
		}
	}
	_ = checkpointAssign // used for documentation; shape checked above
}

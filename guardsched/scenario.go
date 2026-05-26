package guardsched

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gopkg.in/yaml.v3"

	"guard/internal/availability"
)

// Scenario is a YAML-driven planner test fixture (see testdata/scenarios).
type Scenario struct {
	SchemaVersion int    `yaml:"schema_version"`
	Name          string `yaml:"name"`
	Sim           struct {
		AnchorDate      string `yaml:"anchor_date"`
		Days            int    `yaml:"days"`
		Seed            int64  `yaml:"seed"`
		PlanDayStart    string `yaml:"plan_day_start"`
		StartWorkingDay int    `yaml:"start_working_day"`
		Soldiers        int    `yaml:"soldiers"`
	} `yaml:"sim"`
	Zones struct {
		File          string `yaml:"file"`
		SlotsPerBlock int    `yaml:"slots_per_block"`
	} `yaml:"zones"`
	Status []ScenarioStatus `yaml:"status"`
	Expect struct {
		Availability []ExpectAvailability `yaml:"availability"`
		Assignments  struct {
			Forbid []ExpectForbid `yaml:"forbid"`
		} `yaml:"assignments"`
	} `yaml:"expect"`
	AnchorDate time.Time `yaml:"-"`
	Resolved   []availability.Entry `yaml:"-"`
}

type ScenarioStatus struct {
	Soldier        string `yaml:"soldier"`
	State          string `yaml:"state"`
	PlanDay        *int   `yaml:"plan_day"`
	WholePlanDay   bool   `yaml:"whole_plan_day"`
	UntilPlanDay   *int   `yaml:"until_plan_day"`
	UntilTime      string `yaml:"until_time"`
	From           *ScenarioTime `yaml:"from"`
	Until          *ScenarioTime `yaml:"until"`
}

type ScenarioTime struct {
	PlanDay    int    `yaml:"plan_day"`
	PlanDayEnd int    `yaml:"plan_day_end"`
	Time       string `yaml:"time"`
}

type ExpectAvailability struct {
	PlanDay int `yaml:"plan_day"`
	Summary struct {
		Full          int `yaml:"full"`
		AbsentFull    int `yaml:"absent_full"`
		AbsentPartial int `yaml:"absent_partial"`
	} `yaml:"summary"`
}

type ExpectForbid struct {
	PlanDay int    `yaml:"plan_day"`
	Soldier string `yaml:"soldier"`
	Kind    string `yaml:"kind"`
	Block   *int   `yaml:"block"`
	Slot    *int   `yaml:"slot"`
}

// IsStatusOnly is true for schema_version 2 files that contain only status rows
// (no zones.file / sim.days); sim parameters must come from CLI flags.
func (sc *Scenario) IsStatusOnly() bool {
	return sc.SchemaVersion == 2 && strings.TrimSpace(sc.Zones.File) == ""
}

func LoadScenarioYAML(data []byte) (*Scenario, error) {
	var sc Scenario
	if err := yaml.Unmarshal(data, &sc); err != nil {
		return nil, err
	}
	if sc.IsStatusOnly() {
		if sc.Name == "" {
			sc.Name = "status-only"
		}
		return &sc, nil
	}
	if sc.Sim.Days < 1 {
		sc.Sim.Days = 1
	}
	if strings.TrimSpace(sc.Sim.PlanDayStart) == "" {
		sc.Sim.PlanDayStart = DefaultPlanDayStart
	}
	return &sc, nil
}

func LoadScenarioFile(path string) (*Scenario, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return LoadScenarioYAML(data)
}

// ResolveTimes resolves status rows relative to anchor and plan_day_start.
func (sc *Scenario) ResolveTimes(anchor time.Time) error {
	anchor = time.Date(anchor.Year(), anchor.Month(), anchor.Day(), 0, 0, 0, 0, time.UTC)
	sc.AnchorDate = anchor
	planStart, err := ParsePlanDayStart(sc.Sim.PlanDayStart)
	if err != nil {
		return err
	}
	var entries []availability.Entry
	for _, row := range sc.Status {
		st := availability.NormalizeStatus(row.State)
		if st == availability.StatusBase {
			continue
		}
		var fromT, untilT time.Time
		var ok bool
		if row.WholePlanDay && row.PlanDay != nil {
			fromT, untilT = planDayWindow(anchor, *row.PlanDay, planStart)
			ok = true
		} else if row.From != nil && row.Until != nil {
			fromT, ok = resolveScenarioTime(anchor, planStart, row.From, false)
			if !ok {
				return fmt.Errorf("status %s: bad from", row.Soldier)
			}
			untilT, ok = resolveScenarioTime(anchor, planStart, row.Until, true)
			if !ok {
				return fmt.Errorf("status %s: bad until", row.Soldier)
			}
		} else if row.UntilPlanDay != nil && row.UntilTime != "" {
			fromT = anchor.AddDate(0, 0, -365)
			untilT, ok = resolveWall(anchor, *row.UntilPlanDay, row.UntilTime)
			if !ok {
				return fmt.Errorf("status %s: bad until_time", row.Soldier)
			}
		} else {
			return fmt.Errorf("status %s: need from/until or whole_plan_day", row.Soldier)
		}
		end := untilT
		entries = append(entries, availability.Entry{
			SoldierID: row.Soldier,
			StartAt:   fromT,
			EndAt:     &end,
			Status:    st,
		})
	}
	sc.Resolved = entries
	return nil
}

func planDayWindow(anchor time.Time, planDay, planStart int) (time.Time, time.Time) {
	return availability.PlanDayBounds(anchor, planDay, planStart)
}

func resolveScenarioTime(anchor time.Time, planStart int, t *ScenarioTime, isEnd bool) (time.Time, bool) {
	day := t.PlanDay
	if isEnd && t.PlanDayEnd != 0 {
		day = t.PlanDayEnd
	}
	return resolveWall(anchor, day, t.Time)
}

func resolveWall(anchor time.Time, planDay int, hhmm string) (time.Time, bool) {
	hour, err := ParsePlanDayStart(hhmm)
	if err != nil {
		return time.Time{}, false
	}
	cal := anchor.AddDate(0, 0, planDay)
	return time.Date(cal.Year(), cal.Month(), cal.Day(), hour, 0, 0, 0, time.UTC), true
}

// BuildChecker compiles availability for the scenario roster.
func (sc *Scenario) BuildChecker(roster []string) (*availability.Checker, error) {
	planStart, err := ParsePlanDayStart(sc.Sim.PlanDayStart)
	if err != nil {
		return nil, err
	}
	return availability.NewChecker(sc.AnchorDate, planStart, roster, sc.Resolved, sc.Sim.Days), nil
}

// WeekdayForPlanDay returns weekday index 0=Sunday..6=Saturday for sim plan day offset.
func (sc *Scenario) WeekdayForPlanDay(planDay int) int {
	return (sc.Sim.StartWorkingDay + planDay) % 7
}

// ResolveZonesPath resolves zones.file relative to the scenario file directory.
func ResolveZonesPath(scenarioPath, zonesFile string) (string, error) {
	zonesFile = strings.TrimSpace(zonesFile)
	if zonesFile == "" {
		return "", fmt.Errorf("scenario zones.file is empty")
	}
	if filepath.IsAbs(zonesFile) {
		return zonesFile, nil
	}
	base := filepath.Dir(scenarioPath)
	return filepath.Clean(filepath.Join(base, zonesFile)), nil
}

// DefaultAnchorDate parses sim.anchor_date or returns the standard test anchor.
func (sc *Scenario) DefaultAnchorDate() (time.Time, error) {
	s := strings.TrimSpace(sc.Sim.AnchorDate)
	if s == "" {
		return time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC), nil
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return time.Time{}, fmt.Errorf("sim.anchor_date: %w", err)
	}
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC), nil
}

// InferSoldierCount returns sim.soldiers or max(sN)+1 from status rows (minimum minDefault).
func (sc *Scenario) InferSoldierCount(minDefault int) int {
	if sc.Sim.Soldiers > 0 {
		return sc.Sim.Soldiers
	}
	maxIdx := -1
	for _, row := range sc.Status {
		if i, ok := parseSoldierIndex(row.Soldier); ok && i > maxIdx {
			maxIdx = i
		}
	}
	n := maxIdx + 1
	if n < minDefault {
		n = minDefault
	}
	return n
}

func parseSoldierIndex(id string) (int, bool) {
	id = strings.TrimSpace(id)
	if !strings.HasPrefix(id, "s") {
		return 0, false
	}
	var i int
	if _, err := fmt.Sscanf(id[1:], "%d", &i); err != nil {
		return 0, false
	}
	return i, true
}

// Roster builds s0..s{n-1}.
func Roster(n int) []string {
	return SoldierKeys(n)
}

// CheckExpectations validates expect.* after compile + optional sim run.
func (sc *Scenario) CheckExpectations(chk *availability.Checker, recs []*AssignmentRecord, roster []string) error {
	for _, exp := range sc.Expect.Availability {
		day := chk.CompileDay(exp.PlanDay)
		if day.Summary.Full != exp.Summary.Full ||
			day.Summary.AbsentFull != exp.Summary.AbsentFull ||
			day.Summary.AbsentPartial != exp.Summary.AbsentPartial {
			return fmt.Errorf("plan_day %d availability: got full=%d absent_full=%d absent_partial=%d, want full=%d absent_full=%d absent_partial=%d",
				exp.PlanDay, day.Summary.Full, day.Summary.AbsentFull, day.Summary.AbsentPartial,
				exp.Summary.Full, exp.Summary.AbsentFull, exp.Summary.AbsentPartial)
		}
	}
	for _, f := range sc.Expect.Assignments.Forbid {
		if assignmentViolatesForbid(recs, roster, f) {
			return fmt.Errorf("forbidden assignment: %+v", f)
		}
	}
	return nil
}

func assignmentViolatesForbid(recs []*AssignmentRecord, roster []string, f ExpectForbid) bool {
	idx := -1
	for i, id := range roster {
		if id == f.Soldier {
			idx = i
			break
		}
	}
	if idx < 0 {
		return false
	}
	for _, a := range recs {
		if a == nil || a.Day != f.PlanDay || a.SoldierIdx != idx {
			continue
		}
		if f.Kind != "" && a.Kind != f.Kind {
			continue
		}
		if f.Block != nil && a.CalendarBlock != *f.Block {
			continue
		}
		if f.Slot != nil && a.Slot != *f.Slot {
			continue
		}
		return true
	}
	return false
}

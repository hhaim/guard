package availability

import (
	"strings"
	"time"
)

// Checker answers Avail for duty spans against compiled plan-day assignable windows.
type Checker struct {
	anchor           time.Time
	planDayStartHour int
	roster           []string
	index            map[string]int
	entries          []Entry
	compiled         []map[string][]Interval // per day offset: soldier -> assignable intervals
}

func NewChecker(anchor time.Time, planDayStartHour int, roster []string, entries []Entry, days int) *Checker {
	c := &Checker{
		anchor:           anchor,
		planDayStartHour: planDayStartHour,
		roster:           roster,
		index:            make(map[string]int, len(roster)),
		entries:          entries,
		compiled:         make([]map[string][]Interval, days),
	}
	for i, id := range roster {
		c.index[id] = i
	}
	for d := 0; d < days; d++ {
		day := CompileDayAvailability(anchor, d, planDayStartHour, roster, entries)
		m := make(map[string][]Interval)
		winStart, winEnd := PlanDayBounds(anchor, d, planDayStartHour)
		window := Interval{Start: winStart, End: winEnd}
		for _, sid := range day.AvailFull {
			m[sid] = []Interval{window}
		}
		for sid, pairs := range day.AvailPartial {
			var ivs []Interval
			for _, p := range pairs {
				if len(p) < 2 {
					continue
				}
				s := parseWallOnPlanDay(winStart, p[0])
				e := parseWallOnPlanDay(winStart, p[1])
				if s.IsZero() || e.IsZero() {
					continue
				}
				if e.Before(s) || e.Equal(s) {
					// cross midnight within plan day (e.g. 01:00 end next calendar day)
					e = e.AddDate(0, 0, 1)
				}
				ivs = append(ivs, Interval{Start: s, End: e})
			}
			m[sid] = ivs
		}
		c.compiled[d] = m
	}
	return c
}

// parseWallOnPlanDay maps HH:MM on the plan-day's starting calendar date (or +1 if before plan start hour).
func parseWallOnPlanDay(planDayStart time.Time, hhmm string) time.Time {
	t, err := time.Parse("15:04", hhmm)
	if err != nil {
		return time.Time{}
	}
	h, m, _ := t.Clock()
	base := time.Date(planDayStart.Year(), planDayStart.Month(), planDayStart.Day(), h, m, 0, 0, time.UTC)
	if h*60+m < planDayStart.Hour()*60+planDayStart.Minute() {
		base = base.AddDate(0, 0, 1)
	}
	return base
}

func (c *Checker) SoldierIndex(id string) (int, bool) {
	i, ok := c.index[id]
	return i, ok
}

func (c *Checker) Roster() []string { return c.roster }

// CompileDay returns the JSON-oriented day soldiers snapshot.
func (c *Checker) CompileDay(dayOffset int) DaySoldiers {
	return CompileDayAvailability(c.anchor, dayOffset, c.planDayStartHour, c.roster, c.entries)
}

// AvailIdx returns true iff [dutyStart, dutyEnd) ⊆ union(assignable) for that plan day.
func (c *Checker) AvailIdx(idx, day int, dutyStart, dutyEnd time.Time) bool {
	if idx < 0 || idx >= len(c.roster) || day < 0 || day >= len(c.compiled) {
		return false
	}
	if !dutyStart.Before(dutyEnd) {
		return false
	}
	sid := c.roster[idx]
	ivs := c.compiled[day][sid]
	if len(ivs) == 0 {
		return false
	}
	cur := dutyStart
	for cur.Before(dutyEnd) {
		var advanced bool
		for _, a := range ivs {
			if cur.Before(a.Start) || !cur.Before(a.End) {
				continue
			}
			end := a.End
			if end.After(dutyEnd) {
				end = dutyEnd
			}
			cur = end
			advanced = true
			break
		}
		if !advanced {
			return false
		}
	}
	return true
}

// AvailDutyWallHours checks duty on calendar day anchor+day with wall-clock hour range [h0, h1).
func (c *Checker) AvailDutyWallHours(idx, day, h0, h1 int) bool {
	anchor := time.Date(c.anchor.Year(), c.anchor.Month(), c.anchor.Day(), 0, 0, 0, 0, time.UTC)
	cal := anchor.AddDate(0, 0, day)
	start := time.Date(cal.Year(), cal.Month(), cal.Day(), h0, 0, 0, 0, time.UTC)
	end := time.Date(cal.Year(), cal.Month(), cal.Day(), h1, 0, 0, 0, time.UTC)
	if h1 <= h0 {
		end = end.AddDate(0, 0, 1)
	}
	return c.AvailIdx(idx, day, start, end)
}

// AvailRotatingBlock checks one rotating block (plan-day aligned).
func (c *Checker) AvailRotatingBlock(idx, day, block int, planDayStartHour int, shiftHours float64) bool {
	winStart, _ := PlanDayBounds(c.anchor, day, planDayStartHour)
	start := winStart.Add(time.Duration(float64(block)*shiftHours) * time.Hour)
	end := start.Add(time.Duration(shiftHours) * time.Hour)
	return c.AvailIdx(idx, day, start, end)
}

func blockStartHour(planStart int, block int, shiftHours float64) int {
	h := planStart + int(float64(block)*shiftHours)
	h %= 24
	if h < 0 {
		h += 24
	}
	return h
}

// FairnessHours returns assignable (base) and away hours for fairness denominator.
func (c *Checker) FairnessHours(idx, day int) (base, away float64) {
	if idx < 0 || idx >= len(c.roster) {
		return 0, 0
	}
	b, a := FairnessHoursForDay(c.anchor, day, c.planDayStartHour, c.roster[idx], c.entries)
	return b, a
}

// AllEntries returns a copy of entries used by the checker.
func (c *Checker) AllEntries() []Entry {
	return append([]Entry(nil), c.entries...)
}

// MergeEntries appends scenario/DB entries (caller ensures no duplicates policy).
func MergeEntries(base []Entry, extra ...Entry) []Entry {
	out := append([]Entry(nil), base...)
	out = append(out, extra...)
	return out
}

// RosterFromIDs builds roster list preserving order, skipping empty.
func RosterFromIDs(ids []string) []string {
	var out []string
	seen := make(map[string]struct{})
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

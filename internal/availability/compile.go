package availability

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

// PlanDayBounds returns [start, end) for plan-day offset from anchor (UTC midnight dates).
func PlanDayBounds(anchor time.Time, dayOffset, planDayStartHour int) (start, end time.Time) {
	anchor = time.Date(anchor.Year(), anchor.Month(), anchor.Day(), 0, 0, 0, 0, time.UTC)
	d := anchor.AddDate(0, 0, dayOffset)
	start = d.Add(time.Duration(planDayStartHour) * time.Hour)
	end = d.AddDate(0, 0, 1).Add(time.Duration(planDayStartHour) * time.Hour)
	return start, end
}

// Overlaps returns true if [a0,a1) and [b0,b1) intersect (half-open).
func Overlaps(a0, a1, b0, b1 time.Time) bool {
	return a0.Before(b1) && b0.Before(a1)
}

func clipInterval(iv Interval, winStart, winEnd time.Time) (Interval, bool) {
	s := iv.Start
	if s.Before(winStart) {
		s = winStart
	}
	e := iv.End
	if e.After(winEnd) {
		e = winEnd
	}
	if !s.Before(e) {
		return Interval{}, false
	}
	return Interval{Start: s, End: e}, true
}

func unionIntervals(in []Interval) []Interval {
	if len(in) == 0 {
		return nil
	}
	sort.Slice(in, func(i, j int) bool {
		if in[i].Start.Equal(in[j].Start) {
			return in[i].End.Before(in[j].End)
		}
		return in[i].Start.Before(in[j].Start)
	})
	out := []Interval{in[0]}
	for _, iv := range in[1:] {
		last := &out[len(out)-1]
		if !iv.Start.After(last.End) {
			if iv.End.After(last.End) {
				last.End = iv.End
			}
			continue
		}
		out = append(out, iv)
	}
	return out
}

func subtractIntervals(window Interval, blocked []Interval) []Interval {
	blocked = unionIntervals(blocked)
	assignable := []Interval{window}
	for _, b := range blocked {
		var next []Interval
		for _, a := range assignable {
			if !Overlaps(a.Start, a.End, b.Start, b.End) {
				next = append(next, a)
				continue
			}
			if a.Start.Before(b.Start) {
				next = append(next, Interval{Start: a.Start, End: minTime(b.Start, a.End)})
			}
			if b.End.Before(a.End) {
				next = append(next, Interval{Start: maxTime(b.End, a.Start), End: a.End})
			}
		}
		assignable = next
		if len(assignable) == 0 {
			break
		}
	}
	return assignable
}

func minTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}

func maxTime(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}

func entryInterval(e Entry, openEnd time.Time) Interval {
	end := openEnd
	if e.EndAt != nil {
		end = *e.EndAt
	}
	return Interval{Start: e.StartAt.UTC(), End: end.UTC()}
}

// blockedForSoldier returns union of blocking intervals overlapping the plan-day window.
func blockedForSoldier(entries []Entry, soldierID string, winStart, winEnd, openEnd time.Time) []Interval {
	var blocked []Interval
	for _, e := range entries {
		if e.SoldierID != soldierID {
			continue
		}
		st := NormalizeStatus(e.Status)
		if st == StatusBase {
			continue
		}
		iv := entryInterval(e, openEnd)
		cl, ok := clipInterval(iv, winStart, winEnd)
		if !ok {
			continue
		}
		blocked = append(blocked, cl)
	}
	return unionIntervals(blocked)
}

// wallClockHHMM formats t as HH:MM on its calendar date (UTC).
func wallClockHHMM(t time.Time) string {
	return fmt.Sprintf("%02d:%02d", t.Hour(), t.Minute())
}

// CompileDayAvailability builds avail_full / avail_partial for one plan day.
func CompileDayAvailability(
	anchor time.Time,
	dayOffset int,
	planDayStartHour int,
	roster []string,
	entries []Entry,
) DaySoldiers {
	winStart, winEnd := PlanDayBounds(anchor, dayOffset, planDayStartHour)
	openEnd := winEnd.AddDate(0, 0, 3650) // cap open-ended entries

	out := DaySoldiers{
		AvailPartial: make(map[string][][]string),
		AvailAbsent:  nil,
	}

	for _, sid := range roster {
		sid = strings.TrimSpace(sid)
		if sid == "" {
			continue
		}
		window := Interval{Start: winStart, End: winEnd}
		blocked := blockedForSoldier(entries, sid, winStart, winEnd, openEnd)
		assignable := subtractIntervals(window, blocked)

		if len(assignable) == 0 {
			out.AvailAbsent = append(out.AvailAbsent, sid)
			continue
		}

		// Full plan day assignable?
		if len(assignable) == 1 &&
			!assignable[0].Start.After(winStart) &&
			!assignable[0].End.Before(winEnd) {
			out.AvailFull = append(out.AvailFull, sid)
			continue
		}

		var pairs [][]string
		for _, a := range assignable {
			pairs = append(pairs, []string{wallClockHHMM(a.Start), wallClockHHMM(a.End)})
		}
		out.AvailPartial[sid] = pairs
	}

	sort.Strings(out.AvailFull)
	sort.Strings(out.AvailAbsent)
	out.Summary.Full = len(out.AvailFull)
	out.Summary.AbsentPartial = len(out.AvailPartial)
	rosterSet := make(map[string]struct{}, len(roster))
	for _, id := range roster {
		if strings.TrimSpace(id) != "" {
			rosterSet[id] = struct{}{}
		}
	}
	present := len(out.AvailFull) + len(out.AvailPartial)
	out.Summary.AbsentFull = len(rosterSet) - present
	if out.Summary.AbsentFull < 0 {
		out.Summary.AbsentFull = 0
	}
	return out
}

// FairnessHoursForDay returns base (assignable) and away hours within the plan-day window.
func FairnessHoursForDay(
	anchor time.Time,
	dayOffset int,
	planDayStartHour int,
	soldierID string,
	entries []Entry,
) (baseHours, awayHours float64) {
	winStart, winEnd := PlanDayBounds(anchor, dayOffset, planDayStartHour)
	openEnd := winEnd.AddDate(0, 0, 3650)
	window := Interval{Start: winStart, End: winEnd}
	blocked := blockedForSoldier(entries, soldierID, winStart, winEnd, openEnd)
	assignable := subtractIntervals(window, blocked)

	for _, a := range assignable {
		baseHours += a.End.Sub(a.Start).Hours()
	}

	for _, e := range entries {
		if e.SoldierID != soldierID {
			continue
		}
		if NormalizeStatus(e.Status) != StatusAway {
			continue
		}
		iv := entryInterval(e, openEnd)
		cl, ok := clipInterval(iv, winStart, winEnd)
		if !ok {
			continue
		}
		awayHours += cl.End.Sub(cl.Start).Hours()
	}
	return baseHours, awayHours
}

// EntriesForSoldier filters entries for one soldier.
func EntriesForSoldier(entries []Entry, soldierID string) []Entry {
	var out []Entry
	for _, e := range entries {
		if e.SoldierID == soldierID {
			out = append(out, e)
		}
	}
	return out
}

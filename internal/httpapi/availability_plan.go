package httpapi

import (
	"context"
	"time"

	"guard/guardsched"
	"guard/internal/availability"
	"guard/internal/model"
	"guard/internal/repo"
)

func (s *Server) buildPlanAvailability(
	ctx context.Context,
	anchor time.Time,
	days int,
	planDayStartHour int,
	roster []string,
) (guardsched.AvailabilityChecker, map[string]model.PlanDaySoldiers, error) {
	_ = repo.CompactStatusEntries(ctx, s.Pool, anchor)
	winStart, _ := availability.PlanDayBounds(anchor, 0, planDayStartHour)
	_, winEnd := availability.PlanDayBounds(anchor, days, planDayStartHour)
	entries, err := repo.ListStatusEntriesForRange(ctx, s.Pool, winStart, winEnd)
	if err != nil {
		return nil, nil, err
	}
	chk := availability.NewChecker(anchor, planDayStartHour, roster, entries, days)
	out := make(map[string]model.PlanDaySoldiers, days)
	for d := 0; d < days; d++ {
		cal := anchor.AddDate(0, 0, d).Format("2006-01-02")
		day := chk.CompileDay(d)
		out[cal] = model.PlanDaySoldiers{
			AvailFull:    append([]string(nil), day.AvailFull...),
			AvailPartial: day.AvailPartial,
			AvailAbsent:  append([]string(nil), day.AvailAbsent...),
			Summary: &model.PlanSoldiersSummary{
				Full:          day.Summary.Full,
				AbsentFull:    day.Summary.AbsentFull,
				AbsentPartial: day.Summary.AbsentPartial,
			},
		}
	}
	return chk, out, nil
}

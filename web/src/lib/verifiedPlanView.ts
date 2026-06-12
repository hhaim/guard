import type { PlanDoc } from "./planDoc";
import { verifiedDatesFromPlan } from "./planDoc";
import { resolvePlanDayStartHour, resolvePlanDayStartString, weekdayNameForCalendarPlanDay } from "./planDay";

export function verifiedDatesInPlan(plan: PlanDoc | null | undefined): string[] {
  if (!plan) return [];
  return verifiedDatesFromPlan(plan);
}

export function formatVerifiedDayLabel(
  calendarDate: string,
  plan: PlanDoc,
  globalPlanDayStart?: unknown,
): string {
  const hour = resolvePlanDayStartHour(plan.meta, globalPlanDayStart);
  const startStr = resolvePlanDayStartString(plan.meta, globalPlanDayStart);
  const weekday = weekdayNameForCalendarPlanDay(calendarDate, hour);
  return `${weekday}, ${calendarDate} (plan day starts ${startStr} UTC)`;
}

export function verifiedDayChipParts(
  calendarDate: string,
  plan: PlanDoc,
  globalPlanDayStart?: unknown,
): { weekday: string; date: string } {
  const hour = resolvePlanDayStartHour(plan.meta, globalPlanDayStart);
  return {
    weekday: weekdayNameForCalendarPlanDay(calendarDate, hour),
    date: calendarDate.slice(0, 10),
  };
}

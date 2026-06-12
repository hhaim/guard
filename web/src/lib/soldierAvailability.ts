import type { PlanDaySoldiersDoc } from "./planDoc";
import { calendarDateForDay } from "./planDay";
import { planDayBoundsIso, wallClockIso } from "./planDayBounds";

export type SoldierDayKind = "full" | "partial" | "absent";

/** Classify one soldier for a compiled plan-day snapshot. */
export function classifySoldierDay(soldierId: string, day?: PlanDaySoldiersDoc): SoldierDayKind {
  if (!day) return "full";
  if (day.avail_full?.includes(soldierId)) return "full";
  if (day.avail_partial && soldierId in day.avail_partial) return "partial";
  if (day.avail_absent?.includes(soldierId)) return "absent";
  if (day.summary || day.avail_full?.length || day.avail_partial || day.avail_absent?.length) {
    return "absent";
  }
  return "full";
}

function parseWallOnPlanDay(planDayStartMs: number, calendarDate: string, hhmm: string): number {
  const t = wallClockIso(calendarDate, hhmm);
  let ms = new Date(t).getTime();
  const [h, m] = hhmm.split(":").map((x) => Number(x));
  const planStart = new Date(planDayStartMs);
  const planH = planStart.getUTCHours();
  const planM = planStart.getUTCMinutes();
  if (h * 60 + (m || 0) < planH * 60 + planM) {
    ms += 86400000;
  }
  return ms;
}

function dutySpanCoveredByPartial(
  partial: string[][],
  calendarDate: string,
  planDayStartHour: number,
  dutyStartMs: number,
  dutyEndMs: number,
): boolean {
  const { start } = planDayBoundsIso(calendarDate, planDayStartHour);
  const planDayStartMs = new Date(start).getTime();
  const intervals = partial.map(([a, b]) => ({
    start: parseWallOnPlanDay(planDayStartMs, calendarDate, a),
    end: parseWallOnPlanDay(planDayStartMs, calendarDate, b),
  }));
  let cur = dutyStartMs;
  while (cur < dutyEndMs) {
    let advanced = false;
    for (const iv of intervals) {
      if (cur < iv.start || cur >= iv.end) continue;
      const end = Math.min(iv.end, dutyEndMs);
      cur = end;
      advanced = true;
      break;
    }
    if (!advanced) return false;
  }
  return true;
}

/** True when soldier cannot be assigned this block (away/sick/training). */
export function isSoldierUnavailableForBlock(
  soldierId: string,
  calendarDate: string,
  block: number,
  planDayStartHour: number,
  shiftHours: number,
  day?: PlanDaySoldiersDoc,
): boolean {
  if (!day) return false;
  if (day.avail_absent?.includes(soldierId)) return true;
  if (day.avail_full?.includes(soldierId)) return false;
  const partial = day.avail_partial?.[soldierId];
  if (!partial?.length) return false;
  const { start } = planDayBoundsIso(calendarDate, planDayStartHour);
  const winStartMs = new Date(start).getTime();
  const dutyStartMs = winStartMs + block * shiftHours * 3600000;
  const dutyEndMs = dutyStartMs + shiftHours * 3600000;
  return !dutySpanCoveredByPartial(partial, calendarDate, planDayStartHour, dutyStartMs, dutyEndMs);
}

export function calendarDateForPlanDay(anchorDate: string, dayOffset: number): string {
  return calendarDateForDay(anchorDate, dayOffset);
}

const PLAN_DAY_HOURS = 24;

function partialAssignableHours(
  partial: string[][],
  calendarDate: string,
  planDayStartHour: number,
): number {
  const { start, end } = planDayBoundsIso(calendarDate, planDayStartHour);
  const winStartMs = new Date(start).getTime();
  const winEndMs = new Date(end).getTime();
  let total = 0;
  for (const pair of partial) {
    if (pair.length < 2) continue;
    const ivStart = parseWallOnPlanDay(winStartMs, calendarDate, pair[0]!);
    const ivEnd = parseWallOnPlanDay(winStartMs, calendarDate, pair[1]!);
    const clipStart = Math.max(ivStart, winStartMs);
    const clipEnd = Math.min(ivEnd, winEndMs);
    if (clipEnd > clipStart) {
      total += (clipEnd - clipStart) / 3600000;
    }
  }
  return Math.min(PLAN_DAY_HOURS, total);
}

/** Assignable hours within one plan-day window (matches Go FairnessHoursForDay base hours). */
export function soldierAssignableHoursForPlanDay(
  soldierId: string,
  calendarDate: string,
  planDayStartHour: number,
  day?: PlanDaySoldiersDoc,
): number {
  const kind = classifySoldierDay(soldierId, day);
  if (kind === "absent") return 0;
  if (kind === "full") return PLAN_DAY_HOURS;
  const partial = day?.avail_partial?.[soldierId];
  if (!partial?.length) return 0;
  return partialAssignableHours(partial, calendarDate, planDayStartHour);
}

function daySnapshotPresent(day?: PlanDaySoldiersDoc): boolean {
  if (!day) return false;
  return Boolean(
    day.summary ||
      (day.avail_full?.length ?? 0) > 0 ||
      day.avail_partial ||
      (day.avail_absent?.length ?? 0) > 0,
  );
}

/** Total assignable hours for one plan day from a compiled availability snapshot. */
export function planDayAssignableCapacityHours(
  day: PlanDaySoldiersDoc | undefined,
  calendarDate: string,
  planDayStartHour: number,
  rosterSizeForFallback: number,
  hasGlobalSnapshot = false,
): number {
  if (!daySnapshotPresent(day)) {
    if (hasGlobalSnapshot) return 0;
    return Math.max(0, rosterSizeForFallback) * PLAN_DAY_HOURS;
  }
  let total = 0;
  if (day!.summary) {
    total += day!.summary.full * PLAN_DAY_HOURS;
  } else {
    for (const _sid of day!.avail_full ?? []) {
      total += PLAN_DAY_HOURS;
    }
  }
  for (const windows of Object.values(day!.avail_partial ?? {})) {
    total += partialAssignableHours(windows, calendarDate, planDayStartHour);
  }
  return total;
}

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
  // Roster member not in snapshot (e.g. newly added) — default assignable.
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

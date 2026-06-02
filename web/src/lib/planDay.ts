export const DEFAULT_PLAN_DAY_START = "05:00";
export const DEFAULT_PLAN_DAY_START_HOUR = 5;

export type ParsePlanDayStartResult =
  | { ok: true; hour: number; value: string }
  | { ok: false; error: string };

/** Parse "HH:MM" (whole hours only; minutes must be 00). */
export function parsePlanDayStart(raw: unknown): ParsePlanDayStartResult {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) {
    return { ok: true, hour: DEFAULT_PLAN_DAY_START_HOUR, value: DEFAULT_PLAN_DAY_START };
  }
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) {
    return { ok: false, error: "Expected HH:MM (e.g. 05:00)" };
  }
  const hour = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
    return { ok: false, error: "Hour must be 0–23" };
  }
  if (min !== 0) {
    return { ok: false, error: "Minutes must be 00 (whole hours only)" };
  }
  const value = `${String(hour).padStart(2, "0")}:00`;
  return { ok: true, hour, value };
}

export function blockStartHour(planStart: number, block: number, shiftHours: number): number {
  const h = planStart + Math.round(block * shiftHours);
  return ((h % 24) + 24) % 24;
}

/** Hours from the plan-day timeline origin (0 = first plan day starts at planDayStartHour wall clock). */
export function blockTimelineOffset(
  day: number,
  block: number,
  shiftHours: number,
): number {
  return day * 24 + block * shiftHours;
}

/** Absolute timeline coordinate used by segment layout (origin = planDayStartHour). */
export function blockTimelineStartHour(
  day: number,
  block: number,
  planDayStartHour: number,
  shiftHours: number,
): number {
  return planDayStartHour + blockTimelineOffset(day, block, shiftHours);
}

/** Weekday index 0=Sunday..6=Saturday when plan day `dayIndex` begins at `planStartHour` UTC. */
export function weekdayIndexForPlanDayStart(
  anchorDate: string,
  dayIndex: number,
  planStartHour: number,
): number {
  const base = new Date(`${anchorDate}T00:00:00.000Z`);
  if (Number.isNaN(base.getTime())) return 0;
  const ps = ((Math.trunc(planStartHour) % 24) + 24) % 24;
  base.setUTCDate(base.getUTCDate() + dayIndex);
  base.setUTCHours(ps, 0, 0, 0);
  return base.getUTCDay();
}

/** UTC calendar date for plan day index (anchor YYYY-MM-DD + dayIndex). */
export function calendarDateForDay(anchorDate: string, dayIndex: number): string {
  const base = new Date(`${anchorDate}T00:00:00.000Z`);
  if (Number.isNaN(base.getTime())) return anchorDate;
  base.setUTCDate(base.getUTCDate() + dayIndex);
  return base.toISOString().slice(0, 10);
}

export function weekdayLongName(dateIso: string): string {
  const d = new Date(`${dateIso}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}

/** Weekday name at plan-day start (anchor calendar date + dayIndex at planStartHour UTC). */
export function weekdayNameAtPlanDayStart(
  anchorDate: string,
  dayIndex0: number,
  planStartHour: number = DEFAULT_PLAN_DAY_START_HOUR,
): string {
  const wd = weekdayIndexForPlanDayStart(anchorDate, dayIndex0, planStartHour);
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const calendarDate = calendarDateForDay(anchorDate, dayIndex0);
  return names[wd] ?? weekdayLongName(calendarDate);
}

/** Weekday at plan-day start for a single calendar date (plan day 0 = that date). */
export function weekdayNameForCalendarPlanDay(
  calendarDate: string,
  planStartHour: number = DEFAULT_PLAN_DAY_START_HOUR,
): string {
  return weekdayNameAtPlanDayStart(calendarDate, 0, planStartHour);
}

export function planDayTitle(
  dayIndex0: number,
  anchorDate: string,
  planStartHour: number = DEFAULT_PLAN_DAY_START_HOUR,
): string {
  const calendarDate = calendarDateForDay(anchorDate, dayIndex0);
  const weekday = weekdayNameAtPlanDayStart(anchorDate, dayIndex0, planStartHour);
  return `Day ${dayIndex0 + 1} — ${weekday}, ${calendarDate}`;
}

export function planDayTitleForCalendarDate(
  dayIndex0: number,
  calendarDate: string,
  planStartHour: number = DEFAULT_PLAN_DAY_START_HOUR,
): string {
  const weekday = weekdayNameForCalendarPlanDay(calendarDate, planStartHour);
  return `Day ${dayIndex0 + 1} — ${weekday}, ${calendarDate}`;
}

export function resolvePlanDayStartHour(
  meta?: Record<string, unknown> | null,
  globalPlanDayStart?: unknown,
): number {
  if (meta != null) {
    const mh = meta.plan_day_start_hour;
    if (typeof mh === "number" && Number.isFinite(mh)) {
      return ((Math.trunc(mh) % 24) + 24) % 24;
    }
    const parsed = parsePlanDayStart(meta.plan_day_start);
    if (parsed.ok) return parsed.hour;
  }
  const parsed = parsePlanDayStart(globalPlanDayStart ?? DEFAULT_PLAN_DAY_START);
  return parsed.ok ? parsed.hour : DEFAULT_PLAN_DAY_START_HOUR;
}

export function formatWallClockHour(hour: number): string {
  const h = ((Math.trunc(hour) % 24) + 24) % 24;
  return `${String(h).padStart(2, "0")}:00`;
}

/** X-axis layout for soldier timeline charts (0% = plan day start, not midnight). */
export function timelineChartLayout(
  days: number,
  planDayStartHour: number,
  totalSpanHours?: number,
) {
  const spanHours = totalSpanHours ?? days * 24;
  const origin = ((Math.trunc(planDayStartHour) % 24) + 24) % 24;
  return {
    spanHours,
    origin,
    segmentLeftPct(startHour: number): number {
      return ((startHour - origin) / spanHours) * 100;
    },
    segmentWidthPct(duration: number): number {
      return (duration / spanHours) * 100;
    },
    dayBoundaryLeftPct(afterDayIndex: number): number {
      return ((afterDayIndex + 1) * 24) / spanHours * 100;
    },
    tickLeftPct(offsetFromOrigin: number): number {
      return (offsetFromOrigin / spanHours) * 100;
    },
    tickWallClock(offsetFromOrigin: number): string {
      return formatWallClockHour(origin + offsetFromOrigin);
    },
  };
}

export function resolvePlanDayStartString(
  meta?: Record<string, unknown> | null,
  globalPlanDayStart?: unknown,
): string {
  if (meta != null && typeof meta.plan_day_start === "string") {
    const p = parsePlanDayStart(meta.plan_day_start);
    if (p.ok) return p.value;
  }
  const p = parsePlanDayStart(globalPlanDayStart ?? DEFAULT_PLAN_DAY_START);
  return p.ok ? p.value : DEFAULT_PLAN_DAY_START;
}

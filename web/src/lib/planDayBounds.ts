import { calendarDateForDay } from "./planDay";

/** Plan-day window [start, end) in UTC — matches Go `availability.PlanDayBounds`. */
export function planDayBoundsIso(
  calendarDate: string,
  planDayStartHour: number,
): { start: string; end: string } {
  const base = new Date(`${calendarDate}T00:00:00.000Z`);
  const start = new Date(base);
  start.setUTCHours(planDayStartHour, 0, 0, 0);
  const end = new Date(base);
  end.setUTCDate(end.getUTCDate() + 1);
  end.setUTCHours(planDayStartHour, 0, 0, 0);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Wall-clock on a calendar date (UTC), e.g. date=2026-05-27, time=12:00. */
export function wallClockIso(calendarDate: string, hhmm: string): string {
  const [h, m] = hhmm.split(":").map((x) => Number(x));
  const d = new Date(`${calendarDate}T00:00:00.000Z`);
  d.setUTCHours(h || 0, m || 0, 0, 0);
  return d.toISOString();
}

export function addCalendarDays(isoDate: string, n: number): string {
  return calendarDateForDay(isoDate, n);
}

export function formatPartialWindows(windows: string[][] | undefined): string {
  if (!windows?.length) return "";
  return windows.map((w) => (w.length >= 2 ? `${w[0]}–${w[1]}` : w.join("–"))).join(", ");
}

import { addCalendarDays } from "./planDayBounds";

const MAX_PLAN_DAYS = 366;

/** Inclusive calendar dates from fromDate through toDate (YYYY-MM-DD). */
export function enumeratePlanDays(fromDate: string, toDate: string): string[] {
  const out: string[] = [];
  let cur = fromDate;
  while (cur <= toDate) {
    out.push(cur);
    if (cur === toDate) break;
    cur = addCalendarDays(cur, 1);
    if (out.length > MAX_PLAN_DAYS) break;
  }
  return out;
}

export const MAX_PLATOON_VACATION_DAYS = 31;

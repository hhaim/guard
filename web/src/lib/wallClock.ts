const JERUSALEM_TZ = "Asia/Jerusalem";

type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function jerusalemPartsFromDate(date: Date): DateTimeParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: JERUSALEM_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Current Asia/Jerusalem wall clock reinterpreted as UTC (matches Go NowFakeUTC). */
export function nowFakeUtcIso(now: Date = new Date()): string {
  const p = jerusalemPartsFromDate(now);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}.000Z`;
}

/** Fake-UTC calendar date YYYY-MM-DD for the current Jerusalem wall clock. */
export function todayFakeUtcDate(now: Date = new Date()): string {
  return nowFakeUtcIso(now).slice(0, 10);
}

/** @deprecated use todayFakeUtcDate */
export function tomorrowFakeUtcDate(now: Date = new Date()): string {
  const base = new Date(`${todayFakeUtcDate(now)}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + 1);
  return base.toISOString().slice(0, 10);
}

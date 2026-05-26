import { apiGet } from "../api";

/** Canonical schedule/plan JSON (proposals, verified history, exports). */
export const PLAN_DOC_FORMAT_VERSION = 1;

export type ScheduleAssignment = {
  day: number;
  calendar_block: number;
  start_hour: number;
  slot: number;
  soldier_idx: number;
  soldier_id?: string;
  loc_i: number;
  time_j: number;
  weight: number;
  raw_hours: number;
  kind?: string;
  rowspan?: number;
  win_start_block?: number;
  win_end_block?: number;
  window_name?: string;
  linear_busy_span_blocks?: number;
};

export type PlanChange = {
  ts_date: string;
  slot: string;
  shift_index: number;
  shift_label?: string;
  old_soldier_id: string;
  new_soldier_id: string;
};

export type PlanSoldiersSummary = {
  full: number;
  absent_full: number;
  absent_partial: number;
};

export type PlanDaySoldiersDoc = {
  avail_full?: string[];
  avail_partial?: Record<string, string[][]>;
  summary?: PlanSoldiersSummary;
};

export type PlanDoc = {
  format_version: number;
  anchor_date: string;
  days: number;
  shift_hours: number;
  assignments: ScheduleAssignment[];
  soldiers?: Record<string, PlanDaySoldiersDoc>;
  meta?: Record<string, unknown>;
  changes?: PlanChange[];
  updated_at?: string;
};

function num(v: unknown, fallback = 0): number {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string" && v !== "") {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Normalize API/DB JSON into the canonical PlanDoc shape. */
export function normalizeAssignment(raw: Record<string, unknown>): ScheduleAssignment {
  const kind = str(raw.kind) || "rotating";
  const rowspan = num(raw.rowspan, 1);
  return {
    day: num(raw.day),
    calendar_block: num(raw.calendar_block),
    start_hour: num(raw.start_hour),
    slot: num(raw.slot),
    soldier_idx: num(raw.soldier_idx),
    soldier_id: str(raw.soldier_id),
    loc_i: num(raw.loc_i),
    time_j: num(raw.time_j),
    weight: num(raw.weight),
    raw_hours: num(raw.raw_hours),
    kind,
    rowspan: rowspan || 1,
    win_start_block: num(raw.win_start_block),
    win_end_block: num(raw.win_end_block),
    window_name: str(raw.window_name),
    linear_busy_span_blocks: num(raw.linear_busy_span_blocks) || undefined,
  };
}

export function normalizePlanDoc(raw: unknown): PlanDoc {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const assignments = Array.isArray(o.assignments)
    ? o.assignments.map((a) =>
        normalizeAssignment(a && typeof a === "object" ? (a as Record<string, unknown>) : {})
      )
    : [];
  const days = num(o.days, assignments.length > 0 ? inferDaySpan(assignments) : 0);
  const soldiers =
    o.soldiers && typeof o.soldiers === "object" && !Array.isArray(o.soldiers)
      ? (o.soldiers as Record<string, PlanDaySoldiersDoc>)
      : undefined;
  return {
    format_version: num(o.format_version, PLAN_DOC_FORMAT_VERSION),
    anchor_date: str(o.anchor_date) ?? "",
    days,
    shift_hours: num(o.shift_hours, 4),
    assignments,
    soldiers,
    meta: o.meta && typeof o.meta === "object" ? (o.meta as Record<string, unknown>) : undefined,
    changes: Array.isArray(o.changes) ? (o.changes as PlanChange[]) : undefined,
    updated_at: str(o.updated_at),
  };
}

function inferDaySpan(assignments: ScheduleAssignment[]): number {
  let maxDay = 0;
  for (const a of assignments) {
    if (a.day > maxDay) maxDay = a.day;
  }
  return maxDay + 1;
}

/** Verified schedule for a UTC date range (same JSON as proposals). */
export function fetchVerifiedPlan(from: string, to: string): Promise<PlanDoc> {
  return apiGet<unknown>(
    `/api/reports/schedule?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  ).then(normalizePlanDoc);
}

/** Build a PlanDoc from a generate/run API payload. */
export function planDocFromGenerate(data: {
  anchor_date: string;
  days: number;
  shift_hours: number;
  assignments: ScheduleAssignment[];
  soldiers?: Record<string, PlanDaySoldiersDoc>;
  meta?: Record<string, unknown>;
  changes?: PlanChange[];
}): PlanDoc {
  return normalizePlanDoc({
    format_version: PLAN_DOC_FORMAT_VERSION,
    anchor_date: data.anchor_date,
    days: data.days,
    shift_hours: data.shift_hours,
    assignments: data.assignments,
    soldiers: data.soldiers,
    meta: data.meta,
    changes: data.changes,
  });
}

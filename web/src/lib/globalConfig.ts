import { DEFAULT_PLAN_DAY_START, parsePlanDayStart } from "./planDay";

export const MAX_PLAN_DEBUG_DAY_OFFSET = 366;

export type GlobalFormData = {
  history_days: number;
  number_of_iteration: number;
  random_seed: number;
  plan_debug_day_offset: number;
  plan_day_start: string;
  [key: string]: unknown;
};

export const DEFAULT_GLOBAL: GlobalFormData = {
  history_days: 14,
  number_of_iteration: 1,
  random_seed: 42,
  plan_debug_day_offset: 0,
  plan_day_start: DEFAULT_PLAN_DAY_START,
};

const KNOWN_KEYS = [
  "history_days",
  "number_of_iteration",
  "random_seed",
  "plan_debug_day_offset",
  "plan_day_start",
] as const;

function asInt(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return fallback;
}

export function deriveJsonFromForm(form: GlobalFormData): Record<string, unknown> {
  const out: Record<string, unknown> = { ...form };
  for (const k of KNOWN_KEYS) {
    out[k] = form[k];
  }
  return out;
}

export function parseFormFromJson(raw: unknown): GlobalFormData {
  const base = { ...DEFAULT_GLOBAL };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return base;
  }
  const o = raw as Record<string, unknown>;
  const form: GlobalFormData = {
    ...base,
    history_days: asInt(o.history_days, base.history_days),
    number_of_iteration: asInt(o.number_of_iteration, base.number_of_iteration),
    random_seed: asInt(o.random_seed, base.random_seed),
    plan_debug_day_offset: clampPlanDebugDayOffset(asInt(o.plan_debug_day_offset, base.plan_debug_day_offset)),
    plan_day_start: (() => {
      const p = parsePlanDayStart(o.plan_day_start);
      return p.ok ? p.value : base.plan_day_start;
    })(),
  };
  for (const [k, v] of Object.entries(o)) {
    if (!(KNOWN_KEYS as readonly string[]).includes(k)) {
      form[k] = v;
    }
  }
  return form;
}

export function formFromServerValue(value: unknown): GlobalFormData {
  return parseFormFromJson(value ?? DEFAULT_GLOBAL);
}

export function clampPlanDebugDayOffset(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(MAX_PLAN_DEBUG_DAY_OFFSET, Math.trunc(n));
}

export function planDebugDayOffsetFromValue(value: unknown): number {
  return clampPlanDebugDayOffset(formFromServerValue(value).plan_debug_day_offset);
}

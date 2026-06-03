import { apiDelete, apiGet, callApi } from "../api";
import type { PlanChange, PlanDoc, ScheduleAssignment } from "../lib/planDoc";
import { normalizePlanDoc, planDocFromGenerate } from "../lib/planDoc";
import { tomorrowFakeUtcDate } from "../lib/wallClock";

export type { PlanChange, PlanDoc, ScheduleAssignment } from "../lib/planDoc";
/** @deprecated Use PlanDoc */
export type ProposalDoc = PlanDoc;

export type ProposalSlotInfo = {
  slot: string;
  exists: boolean;
  updated_at?: string;
  assignment_count: number;
  version?: number;
};

export type PlanGenerateParams = {
  anchor_date: string;
  days: number;
  slot: string;
  shift_hours?: number;
  min_consecutive_free_hours: number;
  min_free_shifts_after_duty: number;
  band_relative: number;
  sim_trials: number;
  seed?: number;
  debug_day_offset?: number;
};

export type PlanGenerateResult = {
  ok: boolean;
  slot: string;
  anchor_date: string;
  days: number;
  shift_hours: number;
  assignments: ScheduleAssignment[];
  count: number;
  meta?: Record<string, unknown>;
  changes?: PlanChange[];
  proposal?: PlanDoc;
};

export type PlanListResponse = {
  anchor_date: string;
  slots: ProposalSlotInfo[];
};

export type PlanGetResponse = {
  key: string;
  version: number;
  updated_at: string;
  proposal: PlanDoc;
  expected_version: number;
};

export type PlanContext = {
  utc_today: string;
  effective_today: string;
  plan_anchor: string;
  debug_day_offset: number;
  server_day_offset: number;
  config_day_offset: number;
  request_day_offset: number;
  allow_debug_offset: boolean;
  plan_day_start?: string;
  plan_day_start_hour?: number;
};

export function fetchPlanContext(debugDayOffset?: number): Promise<PlanContext> {
  const q =
    debugDayOffset != null && debugDayOffset > 0
      ? `?debug_day_offset=${encodeURIComponent(String(debugDayOffset))}`
      : "";
  return apiGet(`/api/plan/context${q}`);
}

function planDebugQuery(debugDayOffset?: number): string {
  return debugDayOffset != null && debugDayOffset > 0
    ? `&debug_day_offset=${encodeURIComponent(String(debugDayOffset))}`
    : "";
}

/** @deprecated use fetchPlanContext().plan_anchor */
export function tomorrowUTC(): string {
  return tomorrowFakeUtcDate();
}

export function listProposals(anchor: string, debugDayOffset?: number): Promise<PlanListResponse> {
  return apiGet(
    `/api/plan/proposals?anchor=${encodeURIComponent(anchor)}${planDebugQuery(debugDayOffset)}`
  );
}

export function getProposal(
  anchor: string,
  slot: string,
  debugDayOffset?: number
): Promise<PlanGetResponse> {
  return apiGet<PlanGetResponse>(
    `/api/plan/proposals/${slot}?anchor=${encodeURIComponent(anchor)}${planDebugQuery(debugDayOffset)}`
  ).then((res) => ({
    ...res,
    proposal: normalizePlanDoc(res.proposal),
  }));
}

export function generatePlan(body: PlanGenerateParams): Promise<PlanGenerateResult> {
  return callApi<PlanGenerateResult>("/api/plan/generate", {
    method: "POST",
    body: JSON.stringify(body),
  }).then((data) => ({
    ...data,
    proposal: data.proposal
      ? normalizePlanDoc(data.proposal)
      : planDocFromGenerate({
          anchor_date: data.anchor_date,
          days: data.days,
          shift_hours: data.shift_hours,
          assignments: data.assignments,
          meta: data.meta,
          changes: data.changes,
        }),
  }));
}

export function saveProposal(
  anchor: string,
  slot: string,
  plan: PlanDoc,
  expectedVersion: number,
  debugDayOffset?: number
): Promise<{ ok: boolean; version: number }> {
  return callApi(`/api/plan/proposals/${slot}?anchor=${encodeURIComponent(anchor)}${planDebugQuery(debugDayOffset)}`, {
    method: "PUT",
    body: JSON.stringify({ ...normalizePlanDoc(plan), expected_version: expectedVersion }),
  });
}

export function clearProposal(
  anchor: string,
  slot: string,
  debugDayOffset?: number
): Promise<{ ok: boolean; slot: string }> {
  return apiDelete(
    `/api/plan/proposals/${slot}?anchor=${encodeURIComponent(anchor)}${planDebugQuery(debugDayOffset)}`
  ) as Promise<{
    ok: boolean;
    slot: string;
  }>;
}

export type PlanApplyResult = {
  ok: boolean;
  anchor_date: string;
  slot: string;
  dates_written: string[];
};

export function applyPlan(
  anchor: string,
  slot: string,
  debugDayOffset?: number
): Promise<PlanApplyResult> {
  const body: { anchor_date: string; slot: string; debug_day_offset?: number } = {
    anchor_date: anchor,
    slot,
  };
  if (debugDayOffset != null && debugDayOffset > 0) {
    body.debug_day_offset = debugDayOffset;
  }
  return callApi("/api/plan/apply", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function deleteVerifiedScheduleDay(date: string): Promise<{ ok: boolean; date: string }> {
  return apiDelete(`/api/schedule?date=${encodeURIComponent(date)}`) as Promise<{
    ok: boolean;
    date: string;
  }>;
}

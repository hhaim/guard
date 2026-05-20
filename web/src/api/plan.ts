import { apiDelete, apiGet, callApi } from "../api";
import type { ScheduleAssignment } from "../lib/scheduleReport";

export type PlanChange = {
  ts_date: string;
  slot: string;
  shift_index: number;
  shift_label?: string;
  old_soldier_id: string;
  new_soldier_id: string;
};

export type ProposalDoc = {
  format_version: number;
  anchor_date: string;
  days: number;
  shift_hours: number;
  assignments: ScheduleAssignment[];
  meta?: Record<string, unknown>;
  changes?: PlanChange[];
  updated_at?: string;
};

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
  proposal?: ProposalDoc;
};

export type PlanListResponse = {
  anchor_date: string;
  slots: ProposalSlotInfo[];
};

export type PlanGetResponse = {
  key: string;
  version: number;
  updated_at: string;
  proposal: ProposalDoc;
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
};

export function fetchPlanContext(debugDayOffset?: number): Promise<PlanContext> {
  const q =
    debugDayOffset != null && debugDayOffset > 0
      ? `?debug_day_offset=${encodeURIComponent(String(debugDayOffset))}`
      : "";
  return apiGet(`/api/plan/context${q}`);
}

/** @deprecated use fetchPlanContext().plan_anchor */
export function tomorrowUTC(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function listProposals(anchor: string): Promise<PlanListResponse> {
  return apiGet(`/api/plan/proposals?anchor=${encodeURIComponent(anchor)}`);
}

export function getProposal(anchor: string, slot: string): Promise<PlanGetResponse> {
  return apiGet(`/api/plan/proposals/${slot}?anchor=${encodeURIComponent(anchor)}`);
}

export function generatePlan(body: PlanGenerateParams): Promise<PlanGenerateResult> {
  return callApi("/api/plan/generate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function saveProposal(
  anchor: string,
  slot: string,
  proposal: ProposalDoc,
  expectedVersion: number
): Promise<{ ok: boolean; version: number }> {
  return callApi(`/api/plan/proposals/${slot}?anchor=${encodeURIComponent(anchor)}`, {
    method: "PUT",
    body: JSON.stringify({ ...proposal, expected_version: expectedVersion }),
  });
}

export function clearProposal(anchor: string, slot: string): Promise<{ ok: boolean; slot: string }> {
  return apiDelete(`/api/plan/proposals/${slot}?anchor=${encodeURIComponent(anchor)}`) as Promise<{
    ok: boolean;
    slot: string;
  }>;
}

export function applyPlan(anchor: string, slot: string): Promise<{ ok: boolean; rows_written: number }> {
  return callApi("/api/plan/apply", {
    method: "POST",
    body: JSON.stringify({ anchor_date: anchor, slot }),
  });
}

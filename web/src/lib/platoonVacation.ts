import type {
  SoldierStatusEntry,
  SoldierStatusImportPayload,
  SoldierStatusKind,
} from "../api/soldierStatus";
import { planDayBoundsIso } from "./planDayBounds";
import { enumeratePlanDays } from "./planDayRange";
import type { PlanDaySoldiersDoc } from "./planDoc";
import { classifySoldierDay, type SoldierDayKind } from "./soldierAvailability";
import type { Soldier } from "./soldiers";

export type PlatoonTargetStatus = "on_base" | SoldierStatusKind;

/** Resolved state for one soldier on one plan day (partial = not a full-day blocking status). */
export type SoldierPlanDayState = PlatoonTargetStatus | "partial";

export type PlatoonAwayGroup = {
  platoonCode: string;
  soldiers: Soldier[];
  fromDate: string;
  throughDate: string;
};

export type PlatoonStatusDaySnapshot = {
  planDay: string;
  current: SoldierPlanDayState;
  currentLabel: string;
};

/** Soldier left unchanged (did not match from on every plan day in the range). */
export type PlatoonStatusUnchanged = {
  soldier: Soldier;
  reason: string;
  days: PlatoonStatusDaySnapshot[];
};

export type PlatoonStatusUpdate = {
  soldier: Soldier;
  planDay: string;
};

export type PlatoonStatusPlan = {
  platoonMembers: Soldier[];
  updates: PlatoonStatusUpdate[];
  unchanged: PlatoonStatusUnchanged[];
};

const BLOCKING_STATUSES = new Set<SoldierStatusKind>(["away", "sick", "training", "other"]);

export function membersForPlatoon(roster: Soldier[], platoonCode: string): Soldier[] {
  const code = platoonCode.trim();
  return roster.filter((s) => (s.platoon_code?.trim() ?? "") === code);
}

export function planDayStateLabel(state: SoldierPlanDayState): string {
  if (state === "on_base") return "On base";
  if (state === "partial") return "Partial";
  return state.charAt(0).toUpperCase() + state.slice(1);
}

function normalizeEntryStatus(status: string): string {
  return status.trim().toLowerCase();
}

function entryOverlapsWindow(
  e: SoldierStatusEntry,
  winStartMs: number,
  winEndMs: number,
): boolean {
  const s = new Date(e.start_at).getTime();
  const end = e.end_at ? new Date(e.end_at).getTime() : winEndMs + 86400000 * 365;
  return s < winEndMs && end > winStartMs;
}

function entryCoversPlanDay(
  e: SoldierStatusEntry,
  winStartMs: number,
  winEndMs: number,
): boolean {
  const s = new Date(e.start_at).getTime();
  const end = e.end_at ? new Date(e.end_at).getTime() : winEndMs + 86400000 * 365;
  return s <= winStartMs && end >= winEndMs;
}

/** Resolve full-day blocking status from timeline entries when preview shows absent. */
function absentBlockingStatus(
  soldierId: string,
  winStart: string,
  winEnd: string,
  entries: SoldierStatusEntry[],
): PlatoonTargetStatus {
  const winStartMs = new Date(winStart).getTime();
  const winEndMs = new Date(winEnd).getTime();
  let best: { status: PlatoonTargetStatus; span: number } | null = null;

  for (const e of entries) {
    if (e.soldier_id !== soldierId) continue;
    const st = normalizeEntryStatus(e.status);
    if (!BLOCKING_STATUSES.has(st as SoldierStatusKind)) continue;
    if (!entryOverlapsWindow(e, winStartMs, winEndMs)) continue;
    const s = new Date(e.start_at).getTime();
    const end = e.end_at ? new Date(e.end_at).getTime() : winEndMs;
    const clipStart = Math.max(s, winStartMs);
    const clipEnd = Math.min(end, winEndMs);
    const span = clipEnd - clipStart;
    const status = st as PlatoonTargetStatus;
    if (entryCoversPlanDay(e, winStartMs, winEndMs)) {
      return status;
    }
    if (!best || span > best.span) {
      best = { status, span };
    }
  }
  return best?.status ?? "away";
}

/** Current plan-day state for matching “from” filters. */
export function effectivePlanDayState(
  soldierId: string,
  planDay: string,
  planDayStartHour: number,
  day: PlanDaySoldiersDoc | undefined,
  entries: SoldierStatusEntry[],
): SoldierPlanDayState {
  const kind: SoldierDayKind = day ? classifySoldierDay(soldierId, day) : "full";
  if (kind === "full") return "on_base";
  if (kind === "partial") return "partial";
  const { start, end } = planDayBoundsIso(planDay, planDayStartHour);
  return absentBlockingStatus(soldierId, start, end, entries);
}

export function matchesFromState(
  current: SoldierPlanDayState,
  from: PlatoonTargetStatus,
): boolean {
  if (from === "on_base") return current === "on_base";
  if (current === "partial") return false;
  return current === from;
}

/**
 * Soldiers in the “from” state on every plan day in the range move to “to” for the whole range.
 * Anyone else is reported unchanged (no partial updates per day).
 */
export function planPlatoonStatusChange(
  rosterSoldiers: Soldier[],
  platoonCode: string,
  planDays: string[],
  previewsByDay: Record<string, PlanDaySoldiersDoc>,
  statusEntries: SoldierStatusEntry[],
  fromStatus: PlatoonTargetStatus,
  toStatus: PlatoonTargetStatus,
  planDayStartHour: number,
): PlatoonStatusPlan {
  const platoonMembers = membersForPlatoon(rosterSoldiers, platoonCode);
  const updates: PlatoonStatusUpdate[] = [];
  const unchanged: PlatoonStatusUnchanged[] = [];
  const fromLabel = planDayStateLabel(fromStatus);
  const toLabel = planDayStateLabel(toStatus);

  for (const soldier of platoonMembers) {
    const days: PlatoonStatusDaySnapshot[] = planDays.map((planDay) => {
      const current = effectivePlanDayState(
        soldier.id,
        planDay,
        planDayStartHour,
        previewsByDay[planDay],
        statusEntries,
      );
      return {
        planDay,
        current,
        currentLabel: planDayStateLabel(current),
      };
    });

    const allFrom = days.every((d) => matchesFromState(d.current, fromStatus));
    if (!allFrom) {
      unchanged.push({
        soldier,
        reason: `Not ${fromLabel} on every plan day in range`,
        days,
      });
      continue;
    }

    const allAlreadyTo = days.every((d) => d.current === toStatus);
    if (allAlreadyTo) {
      unchanged.push({
        soldier,
        reason: `Already ${toLabel} on every plan day in range`,
        days,
      });
      continue;
    }

    for (const planDay of planDays) {
      updates.push({ soldier, planDay });
    }
  }

  return { platoonMembers, updates, unchanged };
}

export function formatPlatoonStatusReport(opts: {
  platoonCode: string;
  platoonLabel?: string;
  from: PlatoonTargetStatus;
  target: PlatoonTargetStatus;
  fromDate: string;
  throughDate: string;
  updates: PlatoonStatusUpdate[];
  unchanged: PlatoonStatusUnchanged[];
}): string {
  const name = opts.platoonLabel?.trim() || `Platoon ${opts.platoonCode}`;
  const fromL = planDayStateLabel(opts.from);
  const toL = planDayStateLabel(opts.target);
  const uniqueSoldiers = new Set(opts.updates.map((u) => u.soldier.id));
  const lines: string[] = [
    `${name} — ${fromL} → ${toL}`,
    `Plan days: ${opts.fromDate} through ${opts.throughDate}`,
    `Soldiers updated: ${uniqueSoldiers.size} (${opts.updates.length} soldier-days)`,
    "",
  ];
  if (opts.unchanged.length === 0) {
    lines.push("Unchanged soldiers: none");
    return lines.join("\n");
  }
  lines.push(`Unchanged soldiers (${opts.unchanged.length}):`);
  for (const row of [...opts.unchanged].sort((a, b) =>
    a.soldier.id.localeCompare(b.soldier.id),
  )) {
    const label = row.soldier.full_name.trim() || row.soldier.id;
    const daySummary = row.days
      .map((d) => `${d.planDay.slice(5)}: ${d.currentLabel}`)
      .join("; ");
    lines.push(`- ${label}: ${row.reason} — ${daySummary}`);
  }
  return lines.join("\n");
}

export async function copyPlatoonStatusReport(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

/** One import per plan day so soldiers not updated on other days are untouched. */
export function buildPlatoonStatusImportPayloads(
  updates: PlatoonStatusUpdate[],
  planDayStartHour: number,
  target: PlatoonTargetStatus,
  note?: string,
): SoldierStatusImportPayload[] {
  if (updates.length === 0) return [];

  const byDay = new Map<string, Map<string, Soldier>>();
  for (const { soldier, planDay } of updates) {
    let soldiers = byDay.get(planDay);
    if (!soldiers) {
      soldiers = new Map();
      byDay.set(planDay, soldiers);
    }
    soldiers.set(soldier.id, soldier);
  }

  const trimmedNote = note?.trim();
  const payloads: SoldierStatusImportPayload[] = [];

  for (const planDay of [...byDay.keys()].sort()) {
    const soldiers = [...(byDay.get(planDay)?.values() ?? [])];
    const { start, end } = planDayBoundsIso(planDay, planDayStartHour);
    const soldier_ids = soldiers.map((s) => s.id);

    if (target === "on_base") {
      payloads.push({
        range: { from: start, to: end },
        soldier_ids,
        entries: [],
      });
      continue;
    }

    const entries = soldiers.map((s) => ({
      soldier_id: s.id,
      start_at: start,
      end_at: end,
      status: target,
      ...(trimmedNote ? { note: trimmedNote } : {}),
    }));
    payloads.push({
      range: { from: start, to: end },
      soldier_ids,
      entries,
    });
  }

  return payloads;
}

function isPlatoonAbsentOnDay(
  members: Soldier[],
  date: string,
  byDay: Record<string, PlanDaySoldiersDoc>,
): boolean {
  if (members.length === 0) return false;
  const day = byDay[date];
  if (!day) return false;
  return members.every((m) => classifySoldierDay(m.id, day) === "absent");
}

type DateRange = { fromDate: string; throughDate: string };

function contiguousAbsentRanges(
  dayDates: string[],
  isAbsent: (date: string) => boolean,
): DateRange[] {
  const ranges: DateRange[] = [];
  let start: string | null = null;
  let last: string | null = null;
  for (const date of dayDates) {
    if (isAbsent(date)) {
      if (start === null) start = date;
      last = date;
    } else if (start !== null && last !== null) {
      ranges.push({ fromDate: start, throughDate: last });
      start = null;
      last = null;
    }
  }
  if (start !== null && last !== null) {
    ranges.push({ fromDate: start, throughDate: last });
  }
  return ranges;
}

export function detectPlatoonAwayGroups(
  rosterSoldiers: Soldier[],
  dayDates: string[],
  byDay?: Record<string, PlanDaySoldiersDoc>,
): PlatoonAwayGroup[] {
  if (!byDay || dayDates.length === 0) return [];

  const codes = new Set<string>();
  for (const s of rosterSoldiers) {
    const c = s.platoon_code?.trim();
    if (c) codes.add(c);
  }

  const groups: PlatoonAwayGroup[] = [];
  for (const platoonCode of [...codes].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const members = membersForPlatoon(rosterSoldiers, platoonCode);
    if (members.length === 0) continue;

    const ranges = contiguousAbsentRanges(dayDates, (date) =>
      isPlatoonAbsentOnDay(members, date, byDay),
    );
    for (const { fromDate, throughDate } of ranges) {
      groups.push({
        platoonCode,
        soldiers: members,
        fromDate,
        throughDate,
      });
    }
  }
  return groups;
}

export function soldierIdsInPlatoonAwayGroups(groups: PlatoonAwayGroup[]): Set<string> {
  const ids = new Set<string>();
  for (const g of groups) {
    for (const s of g.soldiers) ids.add(s.id);
  }
  return ids;
}

export function formatPlatoonAwaySummary(
  platoonCode: string,
  platoonLabel: string | undefined,
  count: number,
  fromDate: string,
  throughDate: string,
): string {
  const name = platoonLabel?.trim() || `Platoon ${platoonCode}`;
  const range =
    fromDate === throughDate
      ? fromDate.slice(5)
      : `${fromDate.slice(5)} – ${throughDate.slice(5)}`;
  return `${name} — ${count} away · ${range}`;
}

/** @deprecated use buildPlatoonStatusImportPayloads with filtered updates */
export function buildPlatoonStatusImportPayload(
  members: Soldier[],
  fromDate: string,
  throughDate: string,
  planDayStartHour: number,
  target: PlatoonTargetStatus,
  note?: string,
): SoldierStatusImportPayload {
  const days = enumeratePlanDays(fromDate, throughDate);
  const updates: PlatoonStatusUpdate[] = [];
  for (const soldier of members) {
    for (const planDay of days) {
      updates.push({ soldier, planDay });
    }
  }
  const payloads = buildPlatoonStatusImportPayloads(updates, planDayStartHour, target, note);
  if (payloads.length === 1) return payloads[0];
  const first = planDayBoundsIso(days[0], planDayStartHour);
  const last = planDayBoundsIso(days[days.length - 1], planDayStartHour);
  return {
    range: { from: first.start, to: last.end },
    soldier_ids: members.map((s) => s.id),
    entries: payloads.flatMap((p) => p.entries),
  };
}

export function buildPlatoonVacationImportPayload(
  members: Soldier[],
  fromDate: string,
  throughDate: string,
  planDayStartHour: number,
  note?: string,
): SoldierStatusImportPayload {
  return buildPlatoonStatusImportPayload(members, fromDate, throughDate, planDayStartHour, "away", note);
}

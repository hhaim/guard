import type { PlanDaySoldiersDoc, PlanDoc, PlanSoldiersSummary } from "./planDoc";
import type { Soldier } from "./soldiers";

export type SoldierAvailabilityClass = "full" | "absent_full" | "partial";

export type SoldierAvailabilityRow = {
  soldierId: string;
  label: string;
  classification: SoldierAvailabilityClass;
  /** Assignable windows within the plan day (partial only). */
  windows?: string[][];
};

export type PlanDayAvailabilityReport = {
  date: string;
  summary: PlanSoldiersSummary;
  rows: SoldierAvailabilityRow[];
};

function summaryFromDay(day?: PlanDaySoldiersDoc): PlanSoldiersSummary {
  if (day?.summary) return day.summary;
  const full = day?.avail_full?.length ?? 0;
  const partial = day?.avail_partial ? Object.keys(day.avail_partial).length : 0;
  return { full, absent_partial: partial, absent_full: 0 };
}

export function classifySoldierForDay(
  soldierId: string,
  day?: PlanDaySoldiersDoc,
): SoldierAvailabilityClass {
  if (!day) return "full";
  if (day.avail_full?.includes(soldierId)) return "full";
  if (day.avail_partial && soldierId in day.avail_partial) return "partial";
  if (day.avail_absent?.includes(soldierId)) return "absent_full";
  return "full";
}

function formatWindowPair(pair: string[]): string {
  if (pair.length >= 2) return `${pair[0]}–${pair[1]}`;
  return pair.join("–");
}

/** Build per-day availability tables from embedded PlanDoc.soldiers (§7.4). */
export function buildPlanAvailabilityReport(
  plan: PlanDoc,
  soldiers: Soldier[],
  labelForId: (id: string) => string,
): PlanDayAvailabilityReport[] {
  const anchor = plan.anchor_date;
  const anchorDate = new Date(`${anchor}T00:00:00Z`);
  const byId = new Map(soldiers.map((s) => [s.id, s]));
  const rosterIds = soldiers.length
    ? soldiers.map((s) => s.id)
    : [];

  const out: PlanDayAvailabilityReport[] = [];
  for (let d = 0; d < plan.days; d++) {
    const cal = new Date(anchorDate);
    cal.setUTCDate(cal.getUTCDate() + d);
    const date = cal.toISOString().slice(0, 10);
    const dayDoc = plan.soldiers?.[date];
    const summary = summaryFromDay(dayDoc);

    const ids =
      rosterIds.length > 0
        ? rosterIds
        : [
            ...(dayDoc?.avail_full ?? []),
            ...Object.keys(dayDoc?.avail_partial ?? {}),
          ].sort();

    const rows: SoldierAvailabilityRow[] = ids.map((soldierId) => {
      const classification = classifySoldierForDay(soldierId, dayDoc);
      const label =
        labelForId(soldierId) ||
        byId.get(soldierId)?.full_name?.trim() ||
        soldierId;
      const windows =
        classification === "partial"
          ? dayDoc?.avail_partial?.[soldierId]
          : undefined;
      return { soldierId, label, classification, windows };
    });

    rows.sort((a, b) => {
      const order: Record<SoldierAvailabilityClass, number> = {
        full: 0,
        partial: 1,
        absent_full: 2,
      };
      const d0 = order[a.classification] - order[b.classification];
      if (d0 !== 0) return d0;
      return a.label.localeCompare(b.label);
    });

    out.push({ date, summary, rows });
  }
  return out;
}

export function classificationLabel(c: SoldierAvailabilityClass): string {
  switch (c) {
    case "full":
      return "Full";
    case "partial":
      return "Partial";
    default:
      return "Absent (full day)";
  }
}

export function formatAvailabilityWindows(windows?: string[][]): string {
  if (!windows?.length) return "—";
  return windows.map(formatWindowPair).join(", ");
}

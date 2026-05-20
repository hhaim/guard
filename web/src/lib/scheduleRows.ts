import type { ZonesDoc } from "./zones";
import { slotDisplayLabel } from "./zones";
import { buildZoneReportView, type ScheduleAssignment } from "./scheduleReport";

export type ScheduleReportRow = {
  ts_date: string;
  day_index: number;
  slot: string;
  shift_index: number;
  shift_start: string;
  shift_end: string;
  soldier_id: string;
  meta?: {
    kind?: string;
    loc_i?: number;
    time_j?: number;
    weight?: number;
    raw_hours?: number;
    window?: string;
  };
};

function parseDateOnly(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function dateKey(tsDate: string): string {
  return tsDate.slice(0, 10);
}

function buildSlotLabelIndex(zones: ZonesDoc): Map<string, number> {
  const zone = buildZoneReportView(zones, zones.slots.length);
  const m = new Map<string, number>();
  for (let i = 0; i < zone.slotLabels.length; i++) {
    const label = zone.slotLabels[i];
    if (label) m.set(label, i);
  }
  for (let j = 0; j < zones.slots.length; j++) {
    const slot = zones.slots[j];
    if (!slot) continue;
    const label = slotDisplayLabel(slot);
    if (label) m.set(label, j);
    if (slot.name) m.set(slot.name, j);
    if (slot.full_name) m.set(slot.full_name, j);
    m.set(`SLOT${j}`, j);
  }
  return m;
}

function resolveSlotIndex(
  row: ScheduleReportRow,
  labelToIdx: Map<string, number>,
  legacySlot: Map<string, number>,
  slotsPerBlock: number
): number {
  const raw = (row.slot ?? "").trim();
  if (raw && raw !== "<nil>") {
    const byLabel = labelToIdx.get(raw);
    if (byLabel !== undefined) return byLabel;
    const m = /^SLOT(\d+)$/i.exec(raw);
    if (m) {
      const n = Number(m[1]);
      if (n >= 0 && n < slotsPerBlock) return n;
    }
  }
  const key = `${dateKey(row.ts_date)}:${row.shift_index}`;
  const next = legacySlot.get(key) ?? 0;
  legacySlot.set(key, next + 1);
  return next < slotsPerBlock ? next : 0;
}

/** Map verified schedule DB rows to assignment records for stats UI. */
export function scheduleRowsToAssignments(
  rows: ScheduleReportRow[],
  zones: ZonesDoc,
  soldierIds: string[]
): ScheduleAssignment[] {
  if (rows.length === 0) return [];

  const labelToIdx = buildSlotLabelIndex(zones);
  const soldierToIdx = new Map(soldierIds.map((id, i) => [id, i]));
  const legacySlot = new Map<string, number>();
  const slotsPerBlock = zones.slots.length;

  const sortedDates = [...new Set(rows.map((r) => dateKey(r.ts_date)))].sort();
  const anchor = parseDateOnly(sortedDates[0]);
  const useCalendarDays = sortedDates.length > 1;

  const out: ScheduleAssignment[] = [];
  for (const r of rows) {
    const ts = parseDateOnly(r.ts_date);
    const dayFromDate = Math.round((ts.getTime() - anchor.getTime()) / 86400000);
    const day = useCalendarDays
      ? dayFromDate
      : r.day_index > 0
        ? r.day_index - 1
        : dayFromDate;
    const slotIdx = resolveSlotIndex(r, labelToIdx, legacySlot, slotsPerBlock);
    const soldierIdx = soldierToIdx.get(r.soldier_id) ?? 0;
    const meta = r.meta ?? {};
    const startHour = Number.parseInt(r.shift_start.slice(0, 2), 10) || 0;

    out.push({
      day,
      calendar_block: r.shift_index,
      start_hour: startHour,
      slot: slotIdx,
      soldier_idx: soldierIdx,
      soldier_id: r.soldier_id,
      loc_i: meta.loc_i ?? 0,
      time_j: meta.time_j ?? 0,
      weight: meta.weight ?? 1,
      raw_hours: meta.raw_hours ?? zones.shift_hours,
      kind: meta.kind ?? "rotating",
      window_name: meta.window,
    });
  }
  return out;
}

/** Number of simulation days covered by verified rows (calendar span in range). */
export function scheduleDayCount(rows: ScheduleReportRow[], assignments: ScheduleAssignment[]): number {
  const dates = new Set(rows.map((r) => dateKey(r.ts_date)));
  const fromDates = dates.size;
  const fromAssignments =
    assignments.length > 0 ? assignments.reduce((m, a) => Math.max(m, a.day), 0) + 1 : 0;
  return Math.max(fromDates, fromAssignments);
}

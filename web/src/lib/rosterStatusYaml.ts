import type { SoldierStatusEntry, SoldierStatusKind } from "../api/soldierStatus";
import { calendarDateForDay } from "./planDay";
import { planDayBoundsIso } from "./planDayBounds";

export const STATUS_EXPORT_DAYS_BACK = 30;
export const STATUS_EXPORT_DAYS_FORWARD = 365;

export type SoldierStatusYamlEntry = {
  soldier_id: string;
  start_at: string;
  end_at?: string | null;
  status: SoldierStatusKind | string;
  note?: string;
};

export type SoldierStatusYamlDoc = {
  range: { from: string; to: string };
  entries: SoldierStatusYamlEntry[];
};

const BLOCKING = new Set(["away", "sick", "training", "other", "outing", "leave"]);

export function defaultStatusExportRange(
  planAnchor: string,
  planDayStartHour: number,
): { from: string; to: string } {
  const fromDate = calendarDateForDay(planAnchor, -STATUS_EXPORT_DAYS_BACK);
  const toDate = calendarDateForDay(planAnchor, STATUS_EXPORT_DAYS_FORWARD);
  return {
    from: planDayBoundsIso(fromDate, planDayStartHour).start,
    to: planDayBoundsIso(toDate, planDayStartHour).end,
  };
}

export function entriesToYaml(entries: SoldierStatusEntry[]): SoldierStatusYamlEntry[] {
  return entries
    .filter((e) => BLOCKING.has(String(e.status).toLowerCase()))
    .map((e) => ({
      soldier_id: e.soldier_id,
      start_at: e.start_at,
      ...(e.end_at ? { end_at: e.end_at } : {}),
      status: e.status,
      ...(e.note?.trim() ? { note: e.note.trim() } : {}),
    }));
}

export function parseStatusBlock(raw: unknown): SoldierStatusYamlDoc {
  const block = raw as Record<string, unknown> | null;
  if (!block || typeof block !== "object") {
    throw new Error("soldier_status must be a mapping");
  }
  const rangeRaw = block.range as Record<string, unknown> | undefined;
  if (!rangeRaw) {
    throw new Error("soldier_status.range is required");
  }
  const from = String(rangeRaw.from ?? "").trim();
  const to = String(rangeRaw.to ?? "").trim();
  if (!from || !to) {
    throw new Error("soldier_status.range.from and range.to are required");
  }
  const list = Array.isArray(block.entries) ? block.entries : [];
  const entries: SoldierStatusYamlEntry[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const o = row as Record<string, unknown>;
    const soldier_id = String(o.soldier_id ?? "").trim();
    const start_at = String(o.start_at ?? "").trim();
    const status = String(o.status ?? "").trim();
    if (!soldier_id || !start_at || !status) {
      throw new Error("Each status entry needs soldier_id, start_at, and status");
    }
    if (!BLOCKING.has(status.toLowerCase())) {
      continue;
    }
    const end_at = o.end_at != null && String(o.end_at).trim() ? String(o.end_at).trim() : undefined;
    const note = o.note != null ? String(o.note).trim() : undefined;
    entries.push({
      soldier_id,
      start_at,
      status,
      ...(end_at ? { end_at } : {}),
      ...(note ? { note } : {}),
    });
  }
  return { range: { from, to }, entries };
}

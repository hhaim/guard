import type { ScheduleAssignment } from "./planDoc";
import {
  compactVectorTotalHours,
  formatCompactHourVector,
} from "./formatCompactHourVector";
import type { Soldier } from "./soldiers";
import { typeLabel, type SoldierTypesDoc } from "./soldierTypes";

export type SoldierTooltipFields = {
  name: string;
  id: string;
  typeCode: string;
  typeName: string;
  totalHours: number;
  slotHours: number[];
};

export function resolveSoldierMeta(
  soldierIdx: number,
  soldierIds: string[],
  soldiers: Soldier[],
  typesDoc?: SoldierTypesDoc,
): { id: string; name: string; typeCode: string; typeName: string } {
  const id = soldierIds[soldierIdx]?.trim() || `S${soldierIdx}`;
  const byId = new Map(soldiers.map((s) => [s.id, s]));
  const s = byId.get(id);
  const name = s?.full_name?.trim() || id;
  const typeCode = s?.type_code?.trim() || "";
  const typeName = typeCode && typesDoc ? typeLabel(typesDoc, typeCode) : "";
  return { id, name, typeCode, typeName };
}

/** Sum raw_hours per enabled slot (index 0 → slot id 1). */
export function slotHoursFromAssignments(
  assignments: ScheduleAssignment[],
  slotsPerBlock: number,
): number[] {
  const slots = Array(slotsPerBlock).fill(0);
  for (const a of assignments) {
    if (a.slot >= 0 && a.slot < slotsPerBlock) slots[a.slot] += a.raw_hours;
  }
  return slots;
}

export function formatSoldierTooltipLines(fields: SoldierTooltipFields): string[] {
  const lines: string[] = [];
  if (fields.name) lines.push(`n:${fields.name}`);
  if (fields.id) lines.push(`id:${fields.id}`);
  if (fields.typeCode) lines.push(`ty:${fields.typeCode}`);
  if (fields.typeName) lines.push(`tyn:${fields.typeName}`);
  const w = formatCompactHourVector(fields.slotHours);
  const t = compactVectorTotalHours(fields.slotHours);
  lines.push(`t:${t}h`);
  lines.push(`w:${w}`);
  return lines;
}

export function buildSoldierProfileTooltip(
  soldierIdx: number,
  rawHoursBySlot: number[],
  soldierIds: string[],
  soldiers: Soldier[],
  typesDoc?: SoldierTypesDoc,
): string[] {
  const meta = resolveSoldierMeta(soldierIdx, soldierIds, soldiers, typesDoc);
  return formatSoldierTooltipLines({
    ...meta,
    totalHours: compactVectorTotalHours(rawHoursBySlot),
    slotHours: rawHoursBySlot,
  });
}

export function buildMatrixCellTooltip(
  soldierIdx: number,
  shiftAssignments: ScheduleAssignment[],
  slotsPerBlock: number,
  soldierIds: string[],
  soldiers: Soldier[],
  typesDoc?: SoldierTypesDoc,
  coords?: { day: number; slot: number; shift: number },
): string[] {
  const meta = resolveSoldierMeta(soldierIdx, soldierIds, soldiers, typesDoc);
  const slotHours = slotHoursFromAssignments(shiftAssignments, slotsPerBlock);
  const lines = formatSoldierTooltipLines({
    ...meta,
    totalHours: compactVectorTotalHours(slotHours),
    slotHours,
  });
  if (coords) {
    return [`day:${coords.day} slot:${coords.slot} shift:${coords.shift}`, ...lines];
  }
  return lines;
}

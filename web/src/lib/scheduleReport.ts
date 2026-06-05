import { formatCompactHourVector } from "./formatCompactHourVector";
import type { PlanDaySoldiersDoc, ScheduleAssignment } from "./planDoc";
import type { Soldier } from "./soldiers";
import { typeLabel, type SoldierTypesDoc } from "./soldierTypes";
import {
  calendarDateForPlanDay,
  isSoldierUnavailableForBlock,
  planDayAssignableCapacityHours,
} from "./soldierAvailability";
import type { ZonesDoc } from "./zones";
import {
  blockStartHour,
  blockTimelineStartHour,
  weekdayIndexForPlanDayStart,
  formatWallClockHour,
  planDayTitle,
  planDayTitleForCalendarDate,
  weekdayLongName,
  weekdayNameForCalendarPlanDay,
} from "./planDay";
import {
  enabledSlots,
  parseFullDayConfig,
  parseFullDayTeamConfig,
  parseTimeBandBound,
  slotDisplayLabel,
  timeBandContainsStartMin,
} from "./zones";

export type { ScheduleAssignment } from "./planDoc";

export type ZoneReportView = {
  shiftHours: number;
  blocksPerDay: number;
  slotsPerBlock: number;
  locNames: string[];
  locIds: string[];
  locWeights: number[];
  locTypeIds: string[];
  typeWeightMult: Record<string, number>;
  /** full_day_team credited duty fraction (default 1). */
  typeHoursFactor: Record<string, number>;
  slotLabels: string[];
  slotLocIndices: number[];
  slotTypeIds: string[];
  disabledWeekdays: Record<string, number[]>;
  timeNames: string[];
  timeWeights: number[];
  timeFromMin: number[];
  timeToExclMin: number[];
};

export type SoldierBlockRow = {
  day: number;
  block: number;
  window: string;
  timeCategory: string;
  location: string;
  slot: string;
  hours: string;
  weight: string;
  free: boolean;
  /** Block is in full_day / team / windowed duty+rest span but not a rotating post. */
  rest?: boolean;
};

export type MatrixCell = {
  soldierIdx: number | null;
  label: string;
  soldierIndices?: number[];
  labels?: string[];
  rowspan?: number;
  skip?: boolean;
  disabled?: boolean;
};

export type MatrixRow = {
  window: string;
  /** Source plan day index for assignment lookup. */
  srcDay: number;
  /** Source calendar block within srcDay. */
  srcBlock: number;
  /** 0-based plan day index for display matrix (may differ from srcDay for extension rows). */
  planDay: number;
  cells: MatrixCell[];
};

export type MatrixDay = {
  day: number;
  title: string;
  calendarDate?: string;
  weekday?: string;
  headers: { slot: number; label: string; locId: string }[];
  rows: MatrixRow[];
};

export type ScheduleMatrixOpts = {
  planDayStartHour?: number;
  anchorDate?: string;
  /** Real calendar date per plan day index (from verified schedule merge). */
  verifiedDates?: string[];
  /** Roster order (cfg soldiers); used for cell labels when soldier_id is missing. */
  soldierIds?: string[];
};

export type TimelineSegment = {
  startHour: number;
  duration: number;
  onDuty: boolean;
  /** Away/sick/training — not assignable (yellow when not on duty). */
  unavailable?: boolean;
  /** Duty+rest from full_day or full_day_team (orange on timeline). */
  fullDayDuty?: boolean;
};

export type TimelineLane = {
  soldierIdx: number;
  label: string;
  segments: TimelineSegment[];
};

/** Keep lanes with at least one on-duty segment (red or orange). */
export function filterOnDutyTimelineLanes(lanes: TimelineLane[]): TimelineLane[] {
  return lanes.filter((lane) => lane.segments.some((seg) => seg.onDuty));
}

export type TimelineSegmentKind = "off" | "unavailable" | "duty" | "full_day_duty";

export function isFullDayTimelineKind(kind: string | undefined | null): boolean {
  const k = kind?.trim() || "rotating";
  return k === "full_day" || k === "full_day_team";
}

export function isFullDayTimelineAssignment(a: ScheduleAssignment): boolean {
  return isFullDayTimelineKind(a.kind);
}

export function timelineSegmentKind(seg: TimelineSegment): TimelineSegmentKind {
  if (seg.onDuty) return seg.fullDayDuty ? "full_day_duty" : "duty";
  if (seg.unavailable) return "unavailable";
  return "off";
}

export function timelineSegmentClassName(seg: TimelineSegment): string {
  switch (timelineSegmentKind(seg)) {
    case "full_day_duty":
      return "sched-seg sched-seg-full-day";
    case "duty":
      return "sched-seg sched-seg-on";
    case "unavailable":
      return "sched-seg sched-seg-unavail";
    default:
      return "sched-seg sched-seg-off";
  }
}

export function timelineSegmentTitle(seg: TimelineSegment): string {
  switch (timelineSegmentKind(seg)) {
    case "full_day_duty":
      return "full day duty + rest";
    case "duty":
      return "duty + rest";
    case "unavailable":
      return "away/sick";
    default:
      return "off post";
  }
}

export type BuildTimelineOpts = {
  planDayStartHour?: number;
  shiftHours?: number;
  anchorDate?: string;
  verifiedDates?: string[];
  soldierIds?: string[];
  soldiersByDay?: Record<string, PlanDaySoldiersDoc>;
  assignments?: ScheduleAssignment[];
};

export function calendarBlocksPerDay(shiftHours: number): number {
  if (shiftHours <= 0) return 0;
  return Math.round(24 / shiftHours);
}

export function formatBlockWindow(startHour: number, blockHours: number): string {
  const sh = ((startHour % 24) + 24) % 24;
  const bh = blockHours;
  if (Math.abs(bh - Math.round(bh)) < 1e-9) {
    const eh = sh + Math.round(bh);
    if (eh <= 24) return `${pad2(sh)}:00–${pad2(eh)}:00`;
    return `${pad2(sh)}:00–${pad2(eh % 24)}:00 (+1d)`;
  }
  return `${pad2(sh)}:00 (+${bh} h)`;
}

/** Wall-clock window with 0-based shift_id suffix for expert rules / matrix rows. */
export function formatBlockWindowWithShift(
  startHour: number,
  blockHours: number,
  shiftId: number,
): string {
  return `${formatBlockWindow(startHour, blockHours)}(${shiftId})`;
}

export const REPORT_FUTURE_SHIFT_COUNT = 2;
export const REPORT_FUTURE_MAX_HOURS = 12;

export function reportFutureExtensionBlocks(blockHours: number): number {
  if (blockHours <= 0) return 0;
  const cap = Math.floor(REPORT_FUTURE_MAX_HOURS / blockHours + 1e-9);
  return Math.max(0, Math.min(REPORT_FUTURE_SHIFT_COUNT, cap));
}

export const MATRIX_CELL_MAX_SOLDIERS = 10;

export function formatMatrixCellLabels(
  indices: number[],
  labels?: string[],
  maxShow = MATRIX_CELL_MAX_SOLDIERS,
): string {
  const pairs = indices.map((idx, i) => ({
    idx,
    label: labels?.[i] ?? `S${idx}`,
  }));
  pairs.sort((a, b) => a.idx - b.idx);
  const seen = new Set<number>();
  const labs: string[] = [];
  for (const p of pairs) {
    if (seen.has(p.idx)) continue;
    seen.add(p.idx);
    labs.push(p.label);
  }
  if (labs.length <= maxShow) return labs.join(", ");
  return `${labs.slice(0, maxShow).join(", ")} (+${labs.length - maxShow} more)`;
}

function assignmentKind(a: ScheduleAssignment): string {
  return a.kind?.trim() || "rotating";
}

function assignmentLinearOrigin(a: ScheduleAssignment, blocksPd: number): number {
  return a.day * blocksPd + a.calendar_block;
}

function assignmentLinearSpanLen(a: ScheduleAssignment, blocksPd: number): number {
  if (a.linear_busy_span_blocks != null && a.linear_busy_span_blocks > 0) {
    return a.linear_busy_span_blocks;
  }
  const k = assignmentKind(a);
  if (k === "rotating") return 1;
  return Math.max(1, assignmentOccupiedBlocks(a, blocksPd).length);
}

function assignmentCoversLinearIndex(
  a: ScheduleAssignment,
  linearIndex: number,
  blocksPd: number,
): boolean {
  const l0 = assignmentLinearOrigin(a, blocksPd);
  const span = assignmentLinearSpanLen(a, blocksPd);
  return linearIndex >= l0 && linearIndex < l0 + span;
}

function matrixSlotSoldiers(
  srcD: number,
  srcB: number,
  slot: number,
  simDays: number,
  blocksPd: number,
  assignments: ScheduleAssignment[],
  lookupRot: Map<string, { soldierIndices: number[]; labels: string[] }>,
  merged: Map<
    string,
    { soldierIndices: number[]; labels: string[]; rowspan: number; startBlock: number }
  >,
  soldierIds?: string[],
): { soldierIndices: number[]; labels: string[] } {
  if (srcD < simDays) {
    const rot = lookupRot.get(`${srcD}:${srcB}:${slot}`);
    if (rot) return rot;
    const m = merged.get(`${srcD}:${slot}`);
    if (m && m.startBlock <= srcB && srcB < m.startBlock + m.rowspan) {
      return { soldierIndices: m.soldierIndices, labels: m.labels };
    }
  }
  const linearIndex = srcD < simDays ? srcD * blocksPd + srcB : simDays * blocksPd + srcB;
  const pairs: { idx: number; label: string }[] = [];
  for (const a of assignments) {
    if (a.slot !== slot) continue;
    if (!assignmentCoversLinearIndex(a, linearIndex, blocksPd)) continue;
    if (pairs.some((p) => p.idx === a.soldier_idx)) continue;
    pairs.push({ idx: a.soldier_idx, label: soldierLabel(a, soldierIds) });
  }
  pairs.sort((x, y) => x.idx - y.idx);
  return {
    soldierIndices: pairs.map((p) => p.idx),
    labels: pairs.map((p) => p.label),
  };
}

/** Assignments for one soldier in a matrix cell (day × block × slot). */
export function matrixCellAssignmentsForSoldier(
  soldierIdx: number,
  srcDay: number,
  srcBlock: number,
  slot: number,
  simDays: number,
  blocksPd: number,
  assignments: ScheduleAssignment[],
): ScheduleAssignment[] {
  const out: ScheduleAssignment[] = [];
  const linearIndex = srcDay < simDays ? srcDay * blocksPd + srcBlock : simDays * blocksPd + srcBlock;
  for (const a of assignments) {
    if (a.soldier_idx !== soldierIdx || a.slot !== slot) continue;
    const k = a.kind || "rotating";
    if (k === "rotating") {
      if (a.day === srcDay && a.calendar_block === srcBlock) out.push(a);
      continue;
    }
    if (assignmentCoversLinearIndex(a, linearIndex, blocksPd)) out.push(a);
  }
  return out;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function soldierLabel(
  a: { soldier_idx: number; soldier_id?: string },
  soldierIds?: string[],
): string {
  const sid = a.soldier_id?.trim();
  if (sid) return sid;
  const fromRoster = soldierIds?.[a.soldier_idx];
  if (fromRoster) return fromRoster;
  return `S${a.soldier_idx}`;
}

export function buildZoneReportView(doc: ZonesDoc, slotsPerBlock?: number): ZoneReportView {
  const activeSlots = enabledSlots(doc);
  const effectiveSlotsPerBlock = slotsPerBlock ?? activeSlots.length;
  const locById = new Map(doc.zone_loc.map((z) => [z.id, z]));
  const patternByType = new Map(doc.slots_types.map((st) => [st.id, st.pattern]));
  const weekdayNameToIndex: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  const disabledWeekdays: Record<string, number[]> = {};
  for (const st of doc.slots_types) {
    if (st.disabled_weekdays?.length) {
      disabledWeekdays[st.id] = st.disabled_weekdays.map((n) => weekdayNameToIndex[n] ?? -1).filter((i) => i >= 0);
    }
  }
  const locNames = doc.zone_loc.map((z) => z.name || z.id);
  const locIds = doc.zone_loc.map((z) => z.id);
  const locWeights = doc.zone_loc.map((z) => (typeof z.weight === "number" ? z.weight : 1));
  const locTypeIds = doc.zone_loc.map((z) => z.type ?? "");
  const typeWeightMult: Record<string, number> = {};
  const typeHoursFactor: Record<string, number> = {};
  for (const st of doc.slots_types) {
    if (st.pattern === "rotating") continue;
    const cfg = st.config ?? {};
    if (st.pattern === "full_day_team") {
      const team = parseFullDayTeamConfig(cfg);
      typeWeightMult[st.id] = team.weight_multiplier;
      typeHoursFactor[st.id] = team.hours_factor;
    } else if (st.pattern === "full_day") {
      typeWeightMult[st.id] = parseFullDayConfig(cfg).weight_multiplier;
    }
    if (st.pattern === "windowed_slots") {
      const slots = (cfg as { slots?: { weight_multiplier?: number; weight_mult?: number }[] }).slots;
      if (slots?.[0]) {
        typeWeightMult[st.id] =
          slots[0].weight_multiplier ?? slots[0].weight_mult ?? 1;
      }
    }
  }

  const slotLabels: string[] = [];
  const slotLocIndices: number[] = [];
  const slotTypeIds: string[] = [];
  const slotsForReport = activeSlots.slice(0, effectiveSlotsPerBlock);
  for (let j = 0; j < slotsForReport.length; j++) {
    const slot = slotsForReport[j];
    if (!slot) {
      slotLabels.push(`Slot ${j + 1}`);
      slotLocIndices.push(0);
      slotTypeIds.push("");
      continue;
    }
    const li = doc.zone_loc.findIndex((z) => z.id === slot.location_id);
    slotLocIndices.push(li >= 0 ? li : 0);
    slotLabels.push(slotDisplayLabel(slot));
    const loc = li >= 0 ? doc.zone_loc[li] : undefined;
    slotTypeIds.push(loc?.type ?? "");
    void patternByType;
  }

  return {
    shiftHours: doc.shift_hours,
    blocksPerDay: calendarBlocksPerDay(doc.shift_hours),
    slotsPerBlock: slotsForReport.length,
    locNames,
    locIds,
    locWeights,
    locTypeIds,
    typeWeightMult,
    typeHoursFactor,
    slotLabels,
    slotLocIndices,
    slotTypeIds,
    disabledWeekdays,
    timeNames: doc.time_zones.map((t) => t.name),
    timeWeights: doc.time_zones.map((t) => (typeof t.weight === "number" ? t.weight : 1)),
    timeFromMin: doc.time_zones.map((t) => parseTimeBandBound(t.from_hour)),
    timeToExclMin: doc.time_zones.map((t) => parseTimeBandBound(t.to_hour)),
  };
}

/** Pattern weight_multiplier from zones YAML (1 for rotating). */
export function patternWeightMultiplier(
  zone: ZoneReportView,
  a: ScheduleAssignment,
): number {
  const kind = a.kind?.trim() || "rotating";
  if (kind === "rotating") return 1;
  const typeId = zone.locTypeIds[a.loc_i] ?? "";
  return zone.typeWeightMult[typeId] ?? 1;
}

/** Credited duty fraction for full_day_team (1 for other patterns). */
export function patternHoursFactor(zone: ZoneReportView, a: ScheduleAssignment): number {
  const kind = a.kind?.trim() || "rotating";
  if (kind !== "full_day_team") return 1;
  const typeId = zone.locTypeIds[a.loc_i] ?? "";
  const hf = zone.typeHoursFactor[typeId];
  return hf != null && hf > 0 ? hf : 1;
}

/** One calendar block: shift_hours × loc × time × pattern multiplier × hours_factor. */
export function assignmentBlockWeight(
  zone: ZoneReportView,
  a: ScheduleAssignment,
  block: number,
  planDayStartHour: number,
): number {
  const startH = blockStartHour(planDayStartHour, block, zone.shiftHours);
  const timeJ = timeCategoryForHour(startH, zone);
  const lw = zone.locWeights[a.loc_i] ?? 1;
  const tw = zone.timeWeights[timeJ] ?? 1;
  const wm = patternWeightMultiplier(zone, a);
  const hf = patternHoursFactor(zone, a);
  return zone.shiftHours * lw * tw * wm * hf;
}

export function timeCategoryForHour(h: number, zone: ZoneReportView): number {
  const startMin = (((h % 24) + 24) % 24) * 60;
  for (let j = 0; j < zone.timeNames.length; j++) {
    if (timeBandContainsStartMin(zone.timeFromMin[j], zone.timeToExclMin[j], startMin)) {
      return j;
    }
  }
  return 0;
}

function isSlotDisabledOnPlanDay(
  zone: ZoneReportView,
  slotIndex: number,
  calendarDate: string,
  planStartHour: number,
): boolean {
  const typeId = zone.slotTypeIds[slotIndex];
  if (!typeId) return false;
  const wds = zone.disabledWeekdays[typeId];
  if (!wds?.length) return false;
  const wd = weekdayIndexForPlanDayStart(calendarDate, 0, planStartHour);
  return wds.includes(wd);
}

export function assignmentOccupiedBlocks(a: ScheduleAssignment, blocksPd: number): number[] {
  const k = a.kind || "rotating";
  if (k === "full_day" || k === "full_day_team" || k === "windowed") {
    const b0 = a.win_start_block ?? a.calendar_block;
    const b1 = a.win_end_block ?? a.calendar_block;
    const out: number[] = [];
    for (let b = b0; b <= b1; b++) out.push(b);
    return out;
  }
  void blocksPd;
  return [a.calendar_block];
}

export function buildDutyBusy(
  assignments: ScheduleAssignment[],
  days: number,
  numSoldiers: number,
  blocksPd: number,
): boolean[][][] {
  const busy = Array.from({ length: days }, () =>
    Array.from({ length: numSoldiers }, () => Array<boolean>(blocksPd).fill(false)),
  );
  for (const a of assignments) {
    for (const b of assignmentOccupiedBlocks(a, blocksPd)) {
      if (a.day >= 0 && a.day < days && a.soldier_idx >= 0 && a.soldier_idx < numSoldiers && b >= 0 && b < blocksPd) {
        busy[a.day][a.soldier_idx][b] = true;
      }
    }
  }
  return busy;
}

export function inferSoldierCount(assignments: ScheduleAssignment[]): number {
  let max = 0;
  for (const a of assignments) {
    if (a.soldier_idx + 1 > max) max = a.soldier_idx + 1;
  }
  return max;
}

export function buildScheduleMatrices(
  assignments: ScheduleAssignment[],
  days: number,
  zone: ZoneReportView,
  opts?: ScheduleMatrixOpts,
): MatrixDay[] {
  const planStart = opts?.planDayStartHour ?? 0;
  const anchor = opts?.anchorDate?.trim() ?? "";
  const verifiedDates = opts?.verifiedDates;
  const lookupRot = new Map<string, { soldierIndices: number[]; labels: string[] }>();
  const merged = new Map<
    string,
    { soldierIndices: number[]; labels: string[]; rowspan: number; startBlock: number }
  >();

  const soldierIds = opts?.soldierIds;
  const addToGroup = (
    map: Map<string, { soldierIndices: number[]; labels: string[]; rowspan: number; startBlock: number }>,
    key: string,
    soldierIdx: number,
    label: string,
    rowspan: number,
    startBlock: number,
  ) => {
    const cur = map.get(key);
    if (!cur) {
      map.set(key, { soldierIndices: [soldierIdx], labels: [label], rowspan, startBlock });
      return;
    }
    if (!cur.soldierIndices.includes(soldierIdx)) {
      const pairs = cur.soldierIndices.map((idx, i) => ({ idx, label: cur.labels[i] ?? "" }));
      pairs.push({ idx: soldierIdx, label });
      pairs.sort((a, b) => a.idx - b.idx);
      cur.soldierIndices = pairs.map((p) => p.idx);
      cur.labels = pairs.map((p) => p.label);
    }
    cur.rowspan = Math.max(cur.rowspan, rowspan);
  };

  for (const a of assignments) {
    const k = a.kind || "rotating";
    const label = soldierLabel(a, soldierIds);
    if (k === "rotating") {
      const key = `${a.day}:${a.calendar_block}:${a.slot}`;
      const cur = lookupRot.get(key);
      if (!cur) {
        lookupRot.set(key, { soldierIndices: [a.soldier_idx], labels: [label] });
      } else if (!cur.soldierIndices.includes(a.soldier_idx)) {
        cur.soldierIndices.push(a.soldier_idx);
        cur.labels.push(label);
        cur.soldierIndices.sort((x, y) => x - y);
      }
    } else if (k === "full_day" || k === "full_day_team" || k === "windowed") {
      const occ = assignmentOccupiedBlocks(a, zone.blocksPerDay);
      const sb = occ[0] ?? a.win_start_block ?? a.calendar_block;
      const rs = occ.length || a.rowspan || 1;
      addToGroup(merged, `${a.day}:${a.slot}`, a.soldier_idx, label, rs, sb);
    }
  }

  const extBlocks = reportFutureExtensionBlocks(zone.shiftHours);
  const matrices: MatrixDay[] = [];
  for (let d = 0; d < days; d++) {
    const dayCalendarDate =
      verifiedDates?.[d] ?? (anchor ? calendarDateForPlanDay(anchor, d) : "");
    const headers = Array.from({ length: zone.slotsPerBlock }, (_, j) => {
      const li = zone.slotLocIndices[j] ?? 0;
      return {
        slot: j + 1,
        label: zone.slotLabels[j] ?? `Slot ${j + 1}`,
        locId: zone.locIds[li] ?? "",
      };
    });

    const rows: MatrixRow[] = [];
    const skip = Array(zone.slotsPerBlock).fill(0);

    const rowSpecs: { srcD: number; srcB: number; labelB: number }[] = [];
    for (let b = 0; b < zone.blocksPerDay; b++) rowSpecs.push({ srcD: d, srcB: b, labelB: b });
    for (let eb = 0; eb < extBlocks; eb++) {
      const nd = d + 1;
      if (nd < days) rowSpecs.push({ srcD: nd, srcB: eb, labelB: zone.blocksPerDay + eb });
      else rowSpecs.push({ srcD: days, srcB: eb, labelB: zone.blocksPerDay + eb });
    }

    for (const { srcD, srcB, labelB } of rowSpecs) {
      const sh = blockStartHour(planStart, labelB, zone.shiftHours);
      let win = formatBlockWindowWithShift(sh, zone.shiftHours, srcB);
      if (labelB >= zone.blocksPerDay) win = `${win} (next plan day)`;
      const cells: MatrixCell[] = [];
      const inDay = labelB < zone.blocksPerDay;
      for (let j = 0; j < zone.slotsPerBlock; j++) {
        if (inDay && skip[j] > 0) {
          skip[j] -= 1;
          cells.push({ soldierIdx: null, label: "", skip: true });
          continue;
        }
        if (
          inDay &&
          dayCalendarDate &&
          isSlotDisabledOnPlanDay(zone, j, dayCalendarDate, planStart)
        ) {
          if (labelB === 0) {
            cells.push({
              soldierIdx: null,
              label: "—",
              disabled: true,
              rowspan: zone.blocksPerDay,
            });
            skip[j] = zone.blocksPerDay - 1;
          }
          continue;
        }
        if (inDay) {
          const m = merged.get(`${d}:${j}`);
          if (m) {
            if (labelB < m.startBlock) {
              cells.push({ soldierIdx: null, label: "—" });
              continue;
            }
            if (labelB === m.startBlock) {
              const primary = m.soldierIndices[0] ?? null;
              cells.push({
                soldierIdx: primary,
                label: formatMatrixCellLabels(m.soldierIndices, m.labels),
                soldierIndices: m.soldierIndices,
                labels: m.labels,
                rowspan: m.rowspan,
              });
              skip[j] = m.rowspan - 1;
              continue;
            }
          } else {
            const rot = lookupRot.get(`${d}:${labelB}:${j}`);
            if (rot) {
              const primary = rot.soldierIndices[0] ?? null;
              cells.push({
                soldierIdx: primary,
                label: formatMatrixCellLabels(rot.soldierIndices, rot.labels),
                soldierIndices: rot.soldierIndices,
                labels: rot.labels,
              });
              continue;
            }
          }
        }
        const group = matrixSlotSoldiers(
          srcD,
          srcB,
          j,
          days,
          zone.blocksPerDay,
          assignments,
          lookupRot,
          merged,
          soldierIds,
        );
        if (group.soldierIndices.length === 0) {
          cells.push({ soldierIdx: null, label: "—" });
        } else {
          cells.push({
            soldierIdx: group.soldierIndices[0] ?? null,
            label: formatMatrixCellLabels(group.soldierIndices, group.labels),
            soldierIndices: group.soldierIndices,
            labels: group.labels,
          });
        }
      }
      rows.push({ window: win, srcDay: srcD, srcBlock: srcB, planDay: d, cells });
    }
    const weekday = dayCalendarDate
      ? weekdayNameForCalendarPlanDay(dayCalendarDate, planStart)
      : undefined;
    matrices.push({
      day: d,
      title: dayCalendarDate
        ? planDayTitleForCalendarDate(d, dayCalendarDate, planStart)
        : anchor
          ? planDayTitle(d, anchor, planStart)
          : `Day ${d}`,
      calendarDate: dayCalendarDate,
      weekday,
      headers,
      rows,
    });
  }
  return matrices;
}

function buildLinearBusyBlockLookup(
  assignments: ScheduleAssignment[],
  days: number,
  blocksPd: number,
): Map<string, ScheduleAssignment> {
  const lookup = new Map<string, ScheduleAssignment>();
  const maxL = days * blocksPd;
  for (const a of assignments) {
    const span =
      a.linear_busy_span_blocks != null && a.linear_busy_span_blocks > 0
        ? a.linear_busy_span_blocks
        : 0;
    if (span <= 0) continue;
    const L0 = a.day * blocksPd + a.calendar_block;
    for (let k = 0; k < span; k++) {
      const L = L0 + k;
      if (L >= maxL) break;
      const d = Math.floor(L / blocksPd);
      const b = L % blocksPd;
      lookup.set(`${a.soldier_idx}:${d}:${b}`, a);
    }
  }
  return lookup;
}

export function buildSoldierBlockRows(
  soldierIdx: number,
  assignments: ScheduleAssignment[],
  days: number,
  zone: ZoneReportView,
  planDayStartHour = 0,
): SoldierBlockRow[] {
  const dutyLookup = new Map<string, ScheduleAssignment>();
  for (const a of assignments) {
    if (a.soldier_idx !== soldierIdx) continue;
    for (const b of assignmentOccupiedBlocks(a, zone.blocksPerDay)) {
      dutyLookup.set(`${a.day}:${b}`, a);
    }
  }
  const spanLookup = buildLinearBusyBlockLookup(assignments, days, zone.blocksPerDay);

  const rows: SoldierBlockRow[] = [];
  for (let d = 0; d < days; d++) {
    for (let b = 0; b < zone.blocksPerDay; b++) {
      const key = `${d}:${b}`;
      const duty = dutyLookup.get(key);
      const spanA = spanLookup.get(`${soldierIdx}:${d}:${b}`);
      const startH = blockStartHour(planDayStartHour, b, zone.shiftHours);
      const timeJ =
        duty != null ? duty.time_j : timeCategoryForHour(startH, zone);
      const win = formatBlockWindow(startH, zone.shiftHours);
      if (duty != null && assignmentKind(duty) === "rotating") {
        rows.push({
          day: d + 1,
          block: b + 1,
          window: win,
          timeCategory: zone.timeNames[duty.time_j] ?? zone.timeNames[timeJ] ?? "",
          location: zone.locNames[duty.loc_i] ?? "",
          slot: String(duty.slot + 1),
          hours: duty.raw_hours.toFixed(2),
          weight: duty.weight.toFixed(4),
          free: false,
        });
      } else if (spanA != null && spanA.soldier_idx === soldierIdx) {
        const blkW = assignmentBlockWeight(zone, spanA, b, planDayStartHour);
        rows.push({
          day: d + 1,
          block: b + 1,
          window: win,
          timeCategory: zone.timeNames[timeJ] ?? "",
          location: zone.locNames[spanA.loc_i] ?? "",
          slot: "—",
          hours: zone.shiftHours.toFixed(2),
          weight: blkW.toFixed(4),
          free: false,
          rest: true,
        });
      } else if (duty != null) {
        rows.push({
          day: d + 1,
          block: b + 1,
          window: win,
          timeCategory: zone.timeNames[duty.time_j] ?? zone.timeNames[timeJ] ?? "",
          location: zone.locNames[duty.loc_i] ?? "",
          slot: String(duty.slot + 1),
          hours: duty.raw_hours.toFixed(2),
          weight: duty.weight.toFixed(4),
          free: false,
        });
      } else {
        rows.push({
          day: d + 1,
          block: b + 1,
          window: win,
          timeCategory: zone.timeNames[timeJ] ?? "",
          location: "FREE",
          slot: "—",
          hours: zone.shiftHours.toFixed(2),
          weight: "—",
          free: true,
        });
      }
    }
  }
  return rows;
}

export function buildTimelineLanes(
  busy: boolean[][][],
  blockHours: number,
  soldierCount: number,
  planDayStartHour = 0,
  opts?: BuildTimelineOpts,
): TimelineLane[] {
  const soldierIds = opts?.soldierIds;
  const soldiersByDay = opts?.soldiersByDay;
  const anchorDate = opts?.anchorDate?.trim() ?? "";
  const verifiedDates = opts?.verifiedDates;
  const assignmentList = opts?.assignments;
  const days = busy.length;
  const blocksPd = busy[0]?.[0]?.length ?? 0;
  const extBlocks = reportFutureExtensionBlocks(blockHours);
  const fullDayBusy =
    assignmentList?.length && blocksPd > 0
      ? buildFullDayDutyTensor(assignmentList, days, soldierCount, blocksPd, true)
      : undefined;
  const lanes: TimelineLane[] = [];
  for (let s = soldierCount - 1; s >= 0; s--) {
    const segments: TimelineSegment[] = [];
    const soldierId = soldierIds?.[s];
    for (let d = 0; d < days; d++) {
      const cal =
        verifiedDates?.[d] ??
        (anchorDate && soldierId ? calendarDateForPlanDay(anchorDate, d) : "");
      const dayDoc = cal && soldiersByDay ? soldiersByDay[cal] : undefined;
      for (let b = 0; b < (busy[d]?.[s]?.length ?? 0); b++) {
        const onDuty = !!busy[d]?.[s]?.[b];
        const unavailable =
          !onDuty &&
          !!soldierId &&
          !!cal &&
          isSoldierUnavailableForBlock(
            soldierId,
            cal,
            b,
            planDayStartHour,
            blockHours,
            dayDoc,
          );
        segments.push({
          startHour: blockTimelineStartHour(d, b, planDayStartHour, blockHours),
          duration: blockHours,
          onDuty,
          unavailable,
          fullDayDuty: onDuty && !!fullDayBusy?.[d]?.[s]?.[b],
        });
      }
    }
    if (extBlocks > 0 && assignmentList?.length) {
      for (let eb = 0; eb < extBlocks; eb++) {
        const linearIndex = days * blocksPd + eb;
        let onDuty = false;
        let fullDayDuty = false;
        for (const a of assignmentList) {
          if (a.soldier_idx !== s) continue;
          if (assignmentCoversLinearIndex(a, linearIndex, blocksPd)) {
            onDuty = true;
            fullDayDuty = isFullDayTimelineAssignment(a);
            break;
          }
        }
        segments.push({
          startHour: blockTimelineStartHour(days, eb, planDayStartHour, blockHours),
          duration: blockHours,
          onDuty,
          unavailable: false,
          fullDayDuty: onDuty && fullDayDuty,
        });
      }
    }
    const label = soldierIds?.[s] ?? `S${s}`;
    lanes.push({ soldierIdx: s, label, segments });
  }
  return lanes;
}

/** Wall-clock label for a timeline segment (plan-day-aware). */
export function formatTimelineSegmentRange(
  seg: TimelineSegment,
  planDayStartHour: number,
): string {
  const off0 = seg.startHour - planDayStartHour;
  const off1 = off0 + seg.duration;
  return `${formatWallClockHour(planDayStartHour + off0)}–${formatWallClockHour(planDayStartHour + off1)}`;
}

export type SoldierSummaryRow = {
  soldierIdx: number;
  label: string;
  soldierId: string;
  typeCode: string;
  typeName: string;
  totalRawHours: number;
  globalScore: number;
  totalWeight: number;
  rawHoursByLoc: number[];
  rawHoursBySlot: number[];
  rawHoursByTime: number[];
  timeBandPct: number[];
  rawHoursBySlotCompact: string;
  timeBandHoursCompact: string;
  slotIds: number[];
  minMaxFree: number;
  meanMaxFree: number;
  maxMaxFree: number;
};

export type BuildScheduleStatsOpts = {
  soldierIds?: string[];
  soldiers?: Soldier[];
  typesDoc?: SoldierTypesDoc;
};

export type ScheduleFairnessMetrics = {
  stdAllZ: number;
  minStdSlotZ: number;
  stdRawHours: number;
  rawHoursSpread: number;
  fairnessScore: number;
};

export type ScheduleStatsBundle = {
  soldierCount: number;
  nl: number;
  nt: number;
  locLabels: string[];
  timeLabels: string[];
  /** Mean raw guard hours per calendar day in each location (soldier × loc). */
  meanDailyRawLoc: number[][];
  /** Mean raw guard hours per calendar day in each time band (soldier × time). */
  meanDailyRawTime: number[][];
  maxFree: number[][];
  minMaxFreePerSoldier: number[];
  meanMaxFreePerSoldier: number[];
  maxMaxFreePerSoldier: number[];
  summary: SoldierSummaryRow[];
  fairness: ScheduleFairnessMetrics;
  lineChartLoc: Record<string, string | number>[];
  lineChartTime: Record<string, string | number>[];
  maxFreeBarData: { day: number; [key: string]: number }[];
};

export function stddevSample(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  let sumSq = 0;
  for (const v of values) {
    const d = v - mean;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / (n - 1));
}

/** Aggregate duty hours vs assignable roster capacity. */
export type PlanWorkloadMetrics = {
  totalWorkHours: number;
  totalCapacityHours: number;
  loadFactor: number;
  fairnessStdDevHours: number;
};

export type PlanWorkloadOpts = {
  soldierIds: string[];
  anchorDate: string;
  planDayStartHour: number;
  shiftHours: number;
  soldiersByDay?: Record<string, PlanDaySoldiersDoc>;
  /** Only count this 0-based plan day (Stats single-day slice). */
  dayFilter?: number;
};

function assignmentInFutureExtension(
  a: ScheduleAssignment,
  simDays: number,
  blocksPd: number,
  extBlocks: number,
): boolean {
  if (extBlocks <= 0 || a.day < simDays) return false;
  const minIndex = simDays * blocksPd;
  const maxIndex = minIndex + extBlocks;
  for (let li = minIndex; li < maxIndex; li++) {
    if (assignmentCoversLinearIndex(a, li, blocksPd)) return true;
  }
  return false;
}

function assignmentInWorkScope(
  a: ScheduleAssignment,
  simDays: number,
  blocksPd: number,
  extBlocks: number,
  dayFilter: number | undefined,
  includeFutureExtension: boolean,
): boolean {
  if (dayFilter != null) {
    return a.day === dayFilter;
  }
  if (a.day >= 0 && a.day < simDays) return true;
  return includeFutureExtension && assignmentInFutureExtension(a, simDays, blocksPd, extBlocks);
}

function hasAvailabilitySnapshot(soldiersByDay?: Record<string, PlanDaySoldiersDoc>): boolean {
  return soldiersByDay != null && Object.keys(soldiersByDay).length > 0;
}

export function computePlanWorkloadMetrics(
  assignments: ScheduleAssignment[],
  days: number,
  soldierCount: number,
  opts?: PlanWorkloadOpts,
): PlanWorkloadMetrics {
  const n = Math.max(1, soldierCount);
  const simDays = Math.max(1, days);
  const shiftHours = opts?.shiftHours && opts.shiftHours > 0 ? opts.shiftHours : 4;
  const blocksPd = Math.max(1, Math.round(24 / shiftHours));
  const dayFilter = opts?.dayFilter;
  const rosterIds =
    opts?.soldierIds?.filter((id) => id.trim().length > 0) ??
    Array.from({ length: n }, (_, i) => `S${i}`);
  const rosterSize = Math.max(n, rosterIds.length);
  const perSoldier = Array<number>(rosterSize).fill(0);
  let totalWork = 0;

  for (const a of assignments) {
    if (!assignmentInWorkScope(a, simDays, blocksPd, 0, dayFilter, false)) {
      continue;
    }
    const s = a.soldier_idx;
    if (s < 0 || s >= rosterSize) continue;
    const h = a.raw_hours;
    perSoldier[s] += h;
    totalWork += h;
  }

  const dayStart = dayFilter != null ? dayFilter : 0;
  const dayEnd = dayFilter != null ? dayFilter + 1 : simDays;
  const dayCount = Math.max(1, dayEnd - dayStart);
  const anchorDate = opts?.anchorDate?.trim() ?? "";
  const planDayStartHour = opts?.planDayStartHour ?? 5;
  const soldiersByDay = opts?.soldiersByDay;
  const useAvailability = hasAvailabilitySnapshot(soldiersByDay);

  let capacity = 0;
  if (useAvailability && anchorDate) {
    for (let d = dayStart; d < dayEnd; d++) {
      const cal = calendarDateForPlanDay(anchorDate, d);
      const dayDoc = soldiersByDay?.[cal];
      capacity += planDayAssignableCapacityHours(
        dayDoc,
        cal,
        planDayStartHour,
        rosterIds.length,
        true,
      );
    }
  } else {
    capacity = rosterIds.length * dayCount * 24;
  }

  return {
    totalWorkHours: totalWork,
    totalCapacityHours: capacity,
    loadFactor: capacity > 0 ? totalWork / capacity : 0,
    fairnessStdDevHours: stddevSample(perSoldier),
  };
}

/** Load-factor color band: ≤10% green, ≥33% red, between amber. */
export function loadFactorLevel(loadFactor: number): "low" | "mid" | "high" {
  const pct = loadFactor * 100;
  if (pct <= 10) return "low";
  if (pct >= 33) return "high";
  return "mid";
}

/** Busy tensor for rest stats (includes YAML rest_after spans when present). */
export function buildBusyTensor(
  assignments: ScheduleAssignment[],
  days: number,
  numSoldiers: number,
  blocksPd: number,
  includeYamlRest = true,
): boolean[][][] {
  const busy = Array.from({ length: days }, () =>
    Array.from({ length: numSoldiers }, () => Array<boolean>(blocksPd).fill(false)),
  );
  const maxL = days * blocksPd;
  for (const a of assignments) {
    const span =
      includeYamlRest && a.linear_busy_span_blocks != null && a.linear_busy_span_blocks > 0
        ? a.linear_busy_span_blocks
        : 0;
    if (span > 0) {
      const L0 = a.day * blocksPd + a.calendar_block;
      for (let k = 0; k < span; k++) {
        const L = L0 + k;
        if (L >= maxL) break;
        const d = Math.floor(L / blocksPd);
        const b = L % blocksPd;
        if (d >= 0 && d < days && a.soldier_idx >= 0 && a.soldier_idx < numSoldiers && b < blocksPd) {
          busy[d][a.soldier_idx][b] = true;
        }
      }
    } else {
      for (const b of assignmentOccupiedBlocks(a, blocksPd)) {
        if (a.day >= 0 && a.day < days && a.soldier_idx >= 0 && a.soldier_idx < numSoldiers && b < blocksPd) {
          busy[a.day][a.soldier_idx][b] = true;
        }
      }
    }
  }
  return busy;
}

/** Orange timeline segments: full_day / full_day_team duty+rest spans (subset of buildBusyTensor). */
export function buildFullDayDutyTensor(
  assignments: ScheduleAssignment[],
  days: number,
  numSoldiers: number,
  blocksPd: number,
  includeYamlRest = true,
): boolean[][][] {
  const out = Array.from({ length: days }, () =>
    Array.from({ length: numSoldiers }, () => Array<boolean>(blocksPd).fill(false)),
  );
  const maxL = days * blocksPd;
  for (const a of assignments) {
    if (!isFullDayTimelineKind(a.kind)) continue;
    const span =
      includeYamlRest && a.linear_busy_span_blocks != null && a.linear_busy_span_blocks > 0
        ? a.linear_busy_span_blocks
        : 0;
    if (span > 0) {
      const L0 = a.day * blocksPd + a.calendar_block;
      for (let k = 0; k < span; k++) {
        const L = L0 + k;
        if (L >= maxL) break;
        const d = Math.floor(L / blocksPd);
        const b = L % blocksPd;
        if (d >= 0 && d < days && a.soldier_idx >= 0 && a.soldier_idx < numSoldiers && b < blocksPd) {
          out[d][a.soldier_idx][b] = true;
        }
      }
    } else {
      for (const b of assignmentOccupiedBlocks(a, blocksPd)) {
        if (a.day >= 0 && a.day < days && a.soldier_idx >= 0 && a.soldier_idx < numSoldiers && b < blocksPd) {
          out[a.day][a.soldier_idx][b] = true;
        }
      }
    }
  }
  return out;
}

export function computeMaxConsecutiveFreeHours(busy: boolean[][][], blockHours: number): number[][] {
  const days = busy.length;
  if (days === 0) return [];
  const nS = busy[0].length;
  const B = busy[0][0]?.length ?? 0;
  const out: number[][] = [];
  for (let d = 0; d < days; d++) {
    const row: number[] = [];
    for (let s = 0; s < nS; s++) {
      const blocks = busy[d][s];
      let busyAny = false;
      for (let b = 0; b < B; b++) {
        if (blocks[b]) {
          busyAny = true;
          break;
        }
      }
      if (!busyAny) {
        row.push(B * blockHours);
        continue;
      }
      const doubled = [...blocks, ...blocks];
      let run = 0;
      let best = 0;
      for (let j = 0; j < 2 * B; j++) {
        if (!doubled[j]) {
          run++;
          if (run > B) run = B;
          if (run > best) best = run;
        } else {
          run = 0;
        }
      }
      row.push(best * blockHours);
    }
    out.push(row);
  }
  return out;
}

function heatmapStdSummary(Z: number[][]): { stdAll: number; minStdSlot: number } {
  const flat = Z.flat();
  const stdAll = stddevSample(flat);
  const n = Z.length;
  if (n < 2) return { stdAll, minStdSlot: 0 };
  const ncols = Z[0]?.length ?? 0;
  const perCol: number[] = [];
  for (let j = 0; j < ncols; j++) {
    perCol.push(stddevSample(Z.map((row) => row[j] ?? 0)));
  }
  return { stdAll, minStdSlot: perCol.length ? Math.min(...perCol) : 0 };
}

function buildZMatrix(
  rawLoc: number[][],
  rawTime: number[][],
): number[][] {
  const n = rawLoc.length;
  const nl = rawLoc[0]?.length ?? 0;
  const nt = rawTime[0]?.length ?? 0;
  const Z: number[][] = [];
  for (let s = 0; s < n; s++) {
    const row: number[] = [];
    const totLoc = rawLoc[s].reduce((a, b) => a + b, 0);
    for (let i = 0; i < nl; i++) {
      row.push(totLoc > 1e-12 ? rawLoc[s][i] / totLoc : 0);
    }
    const totTime = rawTime[s].reduce((a, b) => a + b, 0);
    for (let j = 0; j < nt; j++) {
      row.push(totTime > 1e-12 ? rawTime[s][j] / totTime : 0);
    }
    Z.push(row);
  }
  return Z;
}

export function buildScheduleStats(
  assignments: ScheduleAssignment[],
  days: number,
  zone: ZoneReportView,
  soldierCount: number,
  opts?: BuildScheduleStatsOpts,
): ScheduleStatsBundle {
  const nl = zone.locNames.length;
  const nt = zone.timeNames.length;
  const slotsPerBlock = zone.slotsPerBlock;
  const blocksPd = zone.blocksPerDay;
  const availableHours = days * 24;

  const rawLoc = Array.from({ length: soldierCount }, () => Array(nl).fill(0));
  const rawSlot = Array.from({ length: soldierCount }, () => Array(slotsPerBlock).fill(0));
  const rawTime = Array.from({ length: soldierCount }, () => Array(nt).fill(0));
  const wGlobal = Array(soldierCount).fill(0);
  const slotIdsPerSoldier = Array.from({ length: soldierCount }, () => new Set<number>());
  const dailyRawLoc = Array.from({ length: days }, () =>
    Array.from({ length: soldierCount }, () => Array(nl).fill(0)),
  );
  const dailyRawTime = Array.from({ length: days }, () =>
    Array.from({ length: soldierCount }, () => Array(nt).fill(0)),
  );

  for (const a of assignments) {
    const s = a.soldier_idx;
    if (s < 0 || s >= soldierCount) continue;
    if (a.day < 0 || a.day >= days) continue;
    const li = a.loc_i;
    const tj = a.time_j;
    if (li >= 0 && li < nl) {
      rawLoc[s][li] += a.raw_hours;
      dailyRawLoc[a.day][s][li] += a.raw_hours;
    }
    if (tj >= 0 && tj < nt) {
      rawTime[s][tj] += a.raw_hours;
      dailyRawTime[a.day][s][tj] += a.raw_hours;
    }
    wGlobal[s] += a.weight;
    if (a.slot >= 0 && a.slot < slotsPerBlock) {
      rawSlot[s][a.slot] += a.raw_hours;
      slotIdsPerSoldier[s].add(a.slot + 1);
    }
  }

  const soldierIds = opts?.soldierIds ?? [];
  const soldiers = opts?.soldiers ?? [];
  const typesDoc = opts?.typesDoc;
  const soldierById = new Map(soldiers.map((s) => [s.id, s]));

  const meanDailyRawLoc = Array.from({ length: soldierCount }, (_, s) =>
    Array.from({ length: nl }, (_, i) => {
      let sum = 0;
      for (let d = 0; d < days; d++) sum += dailyRawLoc[d][s][i];
      return sum / days;
    }),
  );
  const meanDailyRawTime = Array.from({ length: soldierCount }, (_, s) =>
    Array.from({ length: nt }, (_, j) => {
      let sum = 0;
      for (let d = 0; d < days; d++) sum += dailyRawTime[d][s][j];
      return sum / days;
    }),
  );

  const busy = buildBusyTensor(assignments, days, soldierCount, blocksPd, true);
  const maxFree = computeMaxConsecutiveFreeHours(busy, zone.shiftHours);

  const minMaxFreePerSoldier = Array.from({ length: soldierCount }, (_, s) => {
    let mn = Infinity;
    for (let d = 0; d < days; d++) mn = Math.min(mn, maxFree[d][s]);
    return mn === Infinity ? 0 : mn;
  });
  const meanMaxFreePerSoldier = Array.from({ length: soldierCount }, (_, s) => {
    let sum = 0;
    for (let d = 0; d < days; d++) sum += maxFree[d][s];
    return sum / days;
  });
  const maxMaxFreePerSoldier = Array.from({ length: soldierCount }, (_, s) => {
    let mx = 0;
    for (let d = 0; d < days; d++) mx = Math.max(mx, maxFree[d][s]);
    return mx;
  });

  const Z = buildZMatrix(rawLoc, rawTime);
  const { stdAll, minStdSlot } = heatmapStdSummary(Z);
  const rawTotals = rawLoc.map((row) => row.reduce((a, b) => a + b, 0));
  const stdRaw = stddevSample(rawTotals);
  const spread = rawTotals.length ? Math.max(...rawTotals) - Math.min(...rawTotals) : 0;
  const fairness: ScheduleFairnessMetrics = {
    stdAllZ: stdAll,
    minStdSlotZ: minStdSlot,
    stdRawHours: stdRaw,
    rawHoursSpread: spread,
    fairnessScore: stdAll + 0.25 * stdRaw,
  };

  const locShort = zone.locNames.map((n, i) => n || zone.locIds[i] || `L${i}`);
  const timeShort = zone.timeNames.map((n, i) => n || `T${i}`);

  const lineChartLoc = Array.from({ length: soldierCount }, (_, s) => {
    const row: Record<string, string | number> = { soldier: `S${s}` };
    for (let i = 0; i < nl; i++) row[locShort[i]] = Math.round(meanDailyRawLoc[s][i] * 100) / 100;
    return row;
  });
  const lineChartTime = Array.from({ length: soldierCount }, (_, s) => {
    const row: Record<string, string | number> = { soldier: `S${s}` };
    for (let j = 0; j < nt; j++) row[timeShort[j]] = Math.round(meanDailyRawTime[s][j] * 100) / 100;
    return row;
  });

  const maxFreeBarData = Array.from({ length: days }, (_, d) => {
    const row: { day: number; [key: string]: number } = { day: d + 1 };
    for (let s = 0; s < soldierCount; s++) row[`S${s}`] = Math.round(maxFree[d][s] * 100) / 100;
    return row;
  });

  const summary: SoldierSummaryRow[] = Array.from({ length: soldierCount }, (_, s) => {
    const totalRaw = rawTotals[s];
    const totT = rawTime[s].reduce((a, b) => a + b, 0);
    const timeBandPct =
      totT > 1e-12
        ? rawTime[s].map((h) => (100 * h) / totT)
        : rawTime[s].map(() => 0);
    const rosterId = soldierIds[s]?.trim() || `S${s}`;
    const soldierRec = soldierById.get(rosterId);
    const typeCode = soldierRec?.type_code?.trim() ?? "";
    const typeName = typeCode && typesDoc ? typeLabel(typesDoc, typeCode) : "";
    const slotIds = [...slotIdsPerSoldier[s]].sort((a, b) => a - b);
    return {
      soldierIdx: s,
      label: rosterId,
      soldierId: rosterId,
      typeCode,
      typeName,
      totalRawHours: totalRaw,
      globalScore: wGlobal[s] / Math.max(availableHours, 1e-9),
      totalWeight: wGlobal[s],
      rawHoursByLoc: rawLoc[s],
      rawHoursBySlot: rawSlot[s],
      rawHoursByTime: rawTime[s],
      timeBandPct,
      rawHoursBySlotCompact: formatCompactHourVector(rawSlot[s]),
      timeBandHoursCompact: formatCompactHourVector(rawTime[s]),
      slotIds,
      minMaxFree: minMaxFreePerSoldier[s],
      meanMaxFree: meanMaxFreePerSoldier[s],
      maxMaxFree: maxMaxFreePerSoldier[s],
    };
  });

  return {
    soldierCount,
    nl,
    nt,
    locLabels: locShort,
    timeLabels: timeShort,
    meanDailyRawLoc,
    meanDailyRawTime,
    maxFree,
    minMaxFreePerSoldier,
    meanMaxFreePerSoldier,
    maxMaxFreePerSoldier,
    summary,
    fairness,
    lineChartLoc,
    lineChartTime,
    maxFreeBarData,
  };
}

import type { PlanDaySoldiersDoc, ScheduleAssignment } from "./planDoc";
import {
  calendarDateForPlanDay,
  isSoldierUnavailableForBlock,
} from "./soldierAvailability";
import type { ZonesDoc } from "./zones";
import {
  blockStartHour,
  blockTimelineStartHour,
  weekdayIndexForPlanDayStart,
  formatWallClockHour,
  planDayTitle,
  weekdayLongName,
} from "./planDay";
import { parseFullDayConfig, parseFullDayTeamConfig, slotDisplayLabel } from "./zones";

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
  slotLabels: string[];
  slotLocIndices: number[];
  slotTypeIds: string[];
  disabledWeekdays: Record<string, number[]>;
  timeNames: string[];
  timeWeights: number[];
  timeFrom: number[];
  timeTo: number[];
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
  /** Roster order (cfg soldiers); used for cell labels when soldier_id is missing. */
  soldierIds?: string[];
};

export type TimelineSegment = {
  startHour: number;
  duration: number;
  onDuty: boolean;
  /** Away/sick/training — not assignable (yellow when not on duty). */
  unavailable?: boolean;
};

export type BuildTimelineOpts = {
  planDayStartHour?: number;
  shiftHours?: number;
  anchorDate?: string;
  soldierIds?: string[];
  soldiersByDay?: Record<string, PlanDaySoldiersDoc>;
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

export function buildZoneReportView(doc: ZonesDoc, slotsPerBlock: number): ZoneReportView {
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
  for (const st of doc.slots_types) {
    if (st.pattern === "rotating") continue;
    const cfg = st.config ?? {};
    if (st.pattern === "full_day_team") {
      typeWeightMult[st.id] = parseFullDayTeamConfig(cfg).weight_multiplier;
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
  for (let j = 0; j < slotsPerBlock; j++) {
    const slot = doc.slots[j];
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
    slotsPerBlock,
    locNames,
    locIds,
    locWeights,
    locTypeIds,
    typeWeightMult,
    slotLabels,
    slotLocIndices,
    slotTypeIds,
    disabledWeekdays,
    timeNames: doc.time_zones.map((t) => t.name),
    timeWeights: doc.time_zones.map((t) => (typeof t.weight === "number" ? t.weight : 1)),
    timeFrom: doc.time_zones.map((t) => t.from_hour),
    timeTo: doc.time_zones.map((t) => t.to_hour),
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

/** One calendar block: shift_hours × loc × time × pattern multiplier (matches sim / rotating rows). */
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
  return zone.shiftHours * lw * tw * wm;
}

export function timeCategoryForHour(h: number, zone: ZoneReportView): number {
  const hour = ((h % 24) + 24) % 24;
  for (let j = 0; j < zone.timeNames.length; j++) {
    if (hour >= zone.timeFrom[j] && hour <= zone.timeTo[j]) return j;
  }
  return 0;
}

function isSlotDisabledOnPlanDay(
  zone: ZoneReportView,
  slotIndex: number,
  anchorDate: string,
  planDayIndex: number,
  planStartHour: number,
): boolean {
  const typeId = zone.slotTypeIds[slotIndex];
  if (!typeId) return false;
  const wds = zone.disabledWeekdays[typeId];
  if (!wds?.length) return false;
  const wd = weekdayIndexForPlanDayStart(anchorDate, planDayIndex, planStartHour);
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
      addToGroup(
        merged,
        `${a.day}:${a.slot}`,
        a.soldier_idx,
        label,
        a.rowspan ?? assignmentOccupiedBlocks(a, zone.blocksPerDay).length,
        a.win_start_block ?? a.calendar_block,
      );
    }
  }

  const matrices: MatrixDay[] = [];
  for (let d = 0; d < days; d++) {
    const dayCalendarDate = anchor ? calendarDateForPlanDay(anchor, d) : "";
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

    for (let b = 0; b < zone.blocksPerDay; b++) {
      const sh = blockStartHour(planStart, b, zone.shiftHours);
      const cells: MatrixCell[] = [];
      for (let j = 0; j < zone.slotsPerBlock; j++) {
        if (skip[j] > 0) {
          skip[j] -= 1;
          cells.push({ soldierIdx: null, label: "", skip: true });
          continue;
        }
        if (
          anchor &&
          isSlotDisabledOnPlanDay(zone, j, anchor, d, planStart)
        ) {
          if (b === 0) {
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
        const m = merged.get(`${d}:${j}`);
        if (m) {
          if (b === m.startBlock) {
            const primary = m.soldierIndices[0] ?? null;
            cells.push({
              soldierIdx: primary,
              label: m.labels.join(", "),
              soldierIndices: m.soldierIndices,
              labels: m.labels,
              rowspan: m.rowspan,
            });
            skip[j] = m.rowspan - 1;
          } else {
            cells.push({ soldierIdx: null, label: "—" });
          }
        } else {
          const rot = lookupRot.get(`${d}:${b}:${j}`);
          if (rot) {
            const primary = rot.soldierIndices[0] ?? null;
            cells.push({
              soldierIdx: primary,
              label: rot.labels.join(", "),
              soldierIndices: rot.soldierIndices,
              labels: rot.labels,
            });
          } else {
            cells.push({ soldierIdx: null, label: "—" });
          }
        }
      }
      rows.push({ window: formatBlockWindow(sh, zone.shiftHours), cells });
    }
    const weekday = dayCalendarDate ? weekdayLongName(dayCalendarDate) : undefined;
    matrices.push({
      day: d + 1,
      title: anchor ? planDayTitle(d, anchor) : `Day ${d + 1}`,
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

function assignmentKind(a: ScheduleAssignment): string {
  return a.kind?.trim() || "rotating";
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
): { soldierIdx: number; label: string; segments: TimelineSegment[] }[] {
  const soldierIds = opts?.soldierIds;
  const soldiersByDay = opts?.soldiersByDay;
  const anchorDate = opts?.anchorDate?.trim() ?? "";
  const days = busy.length;
  const lanes: { soldierIdx: number; label: string; segments: TimelineSegment[] }[] = [];
  for (let s = soldierCount - 1; s >= 0; s--) {
    const segments: TimelineSegment[] = [];
    const soldierId = soldierIds?.[s];
    for (let d = 0; d < days; d++) {
      const cal =
        anchorDate && soldierId
          ? calendarDateForPlanDay(anchorDate, d)
          : "";
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
  totalRawHours: number;
  globalScore: number;
  rawHoursByLoc: number[];
  timeBandPct: number[];
  minMaxFree: number;
  meanMaxFree: number;
  maxMaxFree: number;
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

/** Aggregate duty hours vs roster capacity (soldier-days × 24 h). */
export type PlanWorkloadMetrics = {
  totalWorkHours: number;
  totalCapacityHours: number;
  loadFactor: number;
  fairnessStdDevHours: number;
};

export function computePlanWorkloadMetrics(
  assignments: ScheduleAssignment[],
  days: number,
  soldierCount: number,
): PlanWorkloadMetrics {
  const n = Math.max(1, soldierCount);
  const perSoldier = Array<number>(n).fill(0);
  let totalWork = 0;
  for (const a of assignments) {
    const s = a.soldier_idx;
    if (s < 0 || s >= n) continue;
    const h = a.raw_hours;
    perSoldier[s] += h;
    totalWork += h;
  }
  const capacity = n * Math.max(1, days) * 24;
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
): ScheduleStatsBundle {
  const nl = zone.locNames.length;
  const nt = zone.timeNames.length;
  const blocksPd = zone.blocksPerDay;
  const availableHours = days * 24;

  const rawLoc = Array.from({ length: soldierCount }, () => Array(nl).fill(0));
  const rawTime = Array.from({ length: soldierCount }, () => Array(nt).fill(0));
  const wGlobal = Array(soldierCount).fill(0);
  const dailyRawLoc = Array.from({ length: days }, () =>
    Array.from({ length: soldierCount }, () => Array(nl).fill(0)),
  );
  const dailyRawTime = Array.from({ length: days }, () =>
    Array.from({ length: soldierCount }, () => Array(nt).fill(0)),
  );

  for (const a of assignments) {
    const s = a.soldier_idx;
    if (s < 0 || s >= soldierCount) continue;
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
  }

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
    return {
      soldierIdx: s,
      label: `S${s}`,
      totalRawHours: totalRaw,
      globalScore: wGlobal[s] / Math.max(availableHours, 1e-9),
      rawHoursByLoc: rawLoc[s],
      timeBandPct,
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

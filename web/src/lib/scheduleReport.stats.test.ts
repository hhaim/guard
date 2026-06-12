import { describe, expect, it } from "vitest";
import {
  buildScheduleStats,
  buildZoneReportView,
  patternHoursFactor,
  type ZoneReportView,
} from "./scheduleReport";
import type { ScheduleAssignment } from "./planDoc";
import type { ZonesDoc } from "./zones";
import { parseFullDayConfig } from "./zones";

const stubZone = (): ZoneReportView => ({
  shiftHours: 4,
  blocksPerDay: 6,
  slotsPerBlock: 5,
  locNames: ["L0"],
  locIds: ["l0"],
  locWeights: [1],
  locTypeIds: [""],
  slotTypeNameById: {},
  typeWeightMult: {},
  typeHoursFactor: {},
  typeFullDayHours: {},
  slotLabels: ["S1"],
  slotLocIndices: [0],
  slotTypeIds: [""],
  disabledWeekdays: {},
  timeNames: ["T0"],
  timeWeights: [1],
  timeFromMin: [0],
  timeToExclMin: [240],
});

const dv3LikeZones = (): ZonesDoc => ({
  schema_version: 2,
  shift_hours: 4,
  slots_types: [
    {
      id: "kitchen",
      name: "מטבח",
      pattern: "full_day",
      config: {
        start: "06:00",
        end: "22:00",
        rest_after_hours: 6,
        weight_multiplier: 0.5,
        headcount: 2,
      },
    },
  ],
  zone_loc: [{ id: "loc_k", type: "kitchen", name: "K", weight: 1, full_name: "מטבח" }],
  slots: [{ location_id: "loc_k", name: "k1", full_name: "" }],
  time_zones: [
    { id: "zone01", name: "overnight", weight: 1.8, from_hour: 1, to_hour: 5 },
    { id: "zone02", name: "morning", weight: 1.4, from_hour: 5, to_hour: 9 },
    { id: "zone03", name: "day", weight: 0.8, from_hour: 9, to_hour: 17 },
    { id: "zone04", name: "evening", weight: 1.3, from_hour: 17, to_hour: 21 },
    { id: "zone05", name: "night", weight: 1, from_hour: 21, to_hour: 1 },
  ],
});

describe("buildScheduleStats", () => {
  it("ignores assignments outside the plan day horizon", () => {
    const assignments: ScheduleAssignment[] = [
      {
        day: 1,
        calendar_block: 0,
        start_hour: 5,
        slot: 0,
        soldier_idx: 11,
        loc_i: 0,
        time_j: 0,
        weight: 1,
        raw_hours: 4,
      },
    ];
    expect(() => buildScheduleStats(assignments, 1, stubZone(), 80)).not.toThrow();
  });

  it("enriches summary with compact vectors, slot ids, and roster labels", () => {
    const assignments: ScheduleAssignment[] = [
      {
        day: 0,
        calendar_block: 0,
        start_hour: 5,
        slot: 2,
        soldier_idx: 0,
        soldier_id: "s0",
        loc_i: 0,
        time_j: 0,
        weight: 3,
        raw_hours: 4,
      },
    ];
    const stats = buildScheduleStats(assignments, 1, stubZone(), 1, {
      soldierIds: ["s0"],
      soldiers: [{ id: "s0", full_name: "Alice", type_code: "A" }],
      typesDoc: { types: [{ code: "A", label: "Alpha" }] },
    });
    const row = stats.summary[0];
    expect(row.label).toBe("S00");
    expect(row.typeCode).toBe("A");
    expect(row.rawHoursBySlotCompact).toBe("[3:4.0]");
    expect(row.timeBandHoursCompact).toBe("[1:4.0]");
    expect(row.slotIds).toEqual([3]);
    expect(row.totalWeight).toBe(3);
  });

  it("distributes full_day hours across time bands per wall-clock hour", () => {
    const zone = buildZoneReportView(dv3LikeZones(), 1);
    const assignments: ScheduleAssignment[] = [
      {
        day: 0,
        calendar_block: 0,
        start_hour: 6,
        slot: 0,
        soldier_idx: 0,
        loc_i: 0,
        time_j: 2,
        weight: 10,
        raw_hours: 17,
        kind: "full_day",
      },
    ];
    const stats = buildScheduleStats(assignments, 1, zone, 1);
    const row = stats.summary[0];
    const timeHours = row.rawHoursByTime;
    expect(timeHours.reduce((a, b) => a + b, 0)).toBeCloseTo(17, 5);
    expect(timeHours[0]).toBeCloseTo(0, 5);
    expect(timeHours[1]).toBeCloseTo(3, 5);
    expect(timeHours[2]).toBeCloseTo(8, 5);
    expect(timeHours[3]).toBeCloseTo(4, 5);
    expect(timeHours[4]).toBeCloseTo(2, 5);
  });

  it("aggregates raw hours by slot type across locations sharing a type", () => {
    const zone = buildZoneReportView({
      ...dv3LikeZones(),
      zone_loc: [
        { id: "loc_a", type: "kitchen", name: "A", weight: 1, full_name: "A" },
        { id: "loc_b", type: "kitchen", name: "B", weight: 1, full_name: "B" },
      ],
      slots: [
        { location_id: "loc_a", name: "a1", full_name: "" },
        { location_id: "loc_b", name: "b1", full_name: "" },
      ],
    }, 2);
    const assignments: ScheduleAssignment[] = [
      {
        day: 0,
        calendar_block: 0,
        start_hour: 5,
        slot: 0,
        soldier_idx: 0,
        loc_i: 0,
        time_j: 0,
        weight: 1,
        raw_hours: 4,
      },
      {
        day: 0,
        calendar_block: 1,
        start_hour: 9,
        slot: 1,
        soldier_idx: 0,
        loc_i: 1,
        time_j: 1,
        weight: 1,
        raw_hours: 3,
      },
    ];
    const stats = buildScheduleStats(assignments, 1, zone, 2);
    expect(stats.slotTypeIds).toEqual(["kitchen"]);
    expect(stats.summary[0].rawHoursBySlotType).toEqual([7]);
    expect(stats.summary[1].rawHoursBySlotType).toEqual([0]);
    expect(stats.summary[1].totalRawHours).toBe(0);
  });

  it("applies hours_factor for full_day assignments", () => {
    const zone = buildZoneReportView(dv3LikeZones(), 1);
    zone.typeHoursFactor.kitchen = 0.5;
    const a: ScheduleAssignment = {
      day: 0,
      calendar_block: 0,
      start_hour: 6,
      slot: 0,
      soldier_idx: 0,
      loc_i: 0,
      time_j: 2,
      weight: 5,
      raw_hours: 8.5,
      kind: "full_day",
    };
    expect(patternHoursFactor(zone, a)).toBe(0.5);
    const stats = buildScheduleStats([a], 1, zone, 1);
    expect(stats.summary[0].rawHoursByTime.reduce((x, y) => x + y, 0)).toBeCloseTo(8.5, 5);
  });
});

describe("parseFullDayConfig", () => {
  it("defaults hours_factor to 1", () => {
    const cfg = parseFullDayConfig({});
    expect(cfg.hours_factor).toBe(1);
  });
});

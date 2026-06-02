import { describe, expect, it } from "vitest";
import type { PlanDaySoldiersDoc, ScheduleAssignment } from "./planDoc";
import {
  classifySoldierDay,
  planDayAssignableCapacityHours,
  soldierAssignableHoursForPlanDay,
} from "./soldierAvailability";
import { computePlanWorkloadMetrics } from "./scheduleReport";

const anchor = "2026-06-01";
const planDayStartHour = 5;

function baseOpts(overrides: Partial<Parameters<typeof computePlanWorkloadMetrics>[3]> = {}) {
  return {
    soldierIds: ["a", "b", "c"],
    anchorDate: anchor,
    planDayStartHour,
    shiftHours: 4,
    ...overrides,
  };
}

function assignment(
  partial: Partial<ScheduleAssignment> & Pick<ScheduleAssignment, "day" | "soldier_idx" | "raw_hours">,
): ScheduleAssignment {
  return {
    calendar_block: 0,
    start_hour: 5,
    slot: 0,
    loc_i: 0,
    time_j: 0,
    weight: 4,
    ...partial,
  };
}

describe("soldierAssignableHoursForPlanDay", () => {
  it("returns 24 for full availability", () => {
    const day: PlanDaySoldiersDoc = { avail_full: ["a"] };
    expect(soldierAssignableHoursForPlanDay("a", anchor, planDayStartHour, day)).toBe(24);
  });

  it("returns 0 for absent soldiers", () => {
    const day: PlanDaySoldiersDoc = { avail_absent: ["a"] };
    expect(soldierAssignableHoursForPlanDay("a", anchor, planDayStartHour, day)).toBe(0);
  });

  it("sums partial window hours", () => {
    const day: PlanDaySoldiersDoc = {
      avail_partial: { a: [["05:00", "17:00"]] },
    };
    expect(soldierAssignableHoursForPlanDay("a", anchor, planDayStartHour, day)).toBe(12);
  });

  it("treats unlisted roster members as absent when snapshot exists", () => {
    const day: PlanDaySoldiersDoc = {
      avail_full: ["a"],
      avail_absent: ["b"],
      summary: { full: 1, absent_full: 1, absent_partial: 0 },
    };
    expect(classifySoldierDay("c", day)).toBe("absent");
    expect(soldierAssignableHoursForPlanDay("c", anchor, planDayStartHour, day)).toBe(0);
  });
});

describe("planDayAssignableCapacityHours", () => {
  it("uses snapshot lists instead of full roster size", () => {
    const day: PlanDaySoldiersDoc = {
      avail_full: Array.from({ length: 60 }, (_, i) => `s${i}`),
      avail_absent: Array.from({ length: 20 }, (_, i) => `away${i}`),
      summary: { full: 60, absent_full: 20, absent_partial: 0 },
    };
    expect(planDayAssignableCapacityHours(day, anchor, planDayStartHour, 80)).toBe(60 * 24);
  });

  it("falls back to roster size when snapshot missing", () => {
    expect(planDayAssignableCapacityHours(undefined, anchor, planDayStartHour, 80)).toBe(80 * 24);
  });

  it("prefers summary.full when avail_full list is stale", () => {
    const day: PlanDaySoldiersDoc = {
      avail_full: Array.from({ length: 80 }, (_, i) => `s${i}`),
      summary: { full: 50, absent_full: 30, absent_partial: 0 },
    };
    expect(planDayAssignableCapacityHours(day, anchor, planDayStartHour, 80, true)).toBe(50 * 24);
  });

  it("returns zero when global snapshot exists but day is missing", () => {
    expect(planDayAssignableCapacityHours(undefined, anchor, planDayStartHour, 80, true)).toBe(0);
  });
});

describe("computePlanWorkloadMetrics", () => {
  it("matches legacy capacity when no availability snapshot", () => {
    const assignments = [assignment({ day: 0, soldier_idx: 0, raw_hours: 4 })];
    const m = computePlanWorkloadMetrics(assignments, 1, 3, baseOpts());
    expect(m.totalCapacityHours).toBe(72);
    expect(m.totalWorkHours).toBe(4);
    expect(m.loadFactor).toBeCloseTo(4 / 72);
  });

  it("excludes absent soldiers from capacity", () => {
    const assignments = [assignment({ day: 0, soldier_idx: 0, raw_hours: 4 })];
    const soldiersByDay: Record<string, PlanDaySoldiersDoc> = {
      [anchor]: {
        avail_full: ["a", "b"],
        avail_absent: ["c"],
        summary: { full: 2, absent_full: 1, absent_partial: 0 },
      },
    };
    const m = computePlanWorkloadMetrics(assignments, 1, 3, baseOpts({ soldiersByDay }));
    expect(m.totalCapacityHours).toBe(48);
    expect(m.loadFactor).toBeCloseTo(4 / 48);
  });

  it("matches badge counts for 50/30 availability on an 80-soldier roster", () => {
    const assignments = [assignment({ day: 0, soldier_idx: 0, raw_hours: 192 })];
    const soldiersByDay: Record<string, PlanDaySoldiersDoc> = {
      [anchor]: {
        avail_full: Array.from({ length: 80 }, (_, i) => `s${i}`),
        summary: { full: 50, absent_full: 30, absent_partial: 0 },
      },
    };
    const m = computePlanWorkloadMetrics(
      assignments,
      1,
      80,
      baseOpts({ soldierIds: Array.from({ length: 80 }, (_, i) => `s${i}`), soldiersByDay }),
    );
    expect(m.totalCapacityHours).toBe(50 * 24);
    expect(m.loadFactor).toBeCloseTo(192 / (50 * 24));
  });

  it("uses partial assignable hours in capacity", () => {
    const assignments = [assignment({ day: 0, soldier_idx: 0, raw_hours: 4 })];
    const soldiersByDay: Record<string, PlanDaySoldiersDoc> = {
      [anchor]: {
        avail_full: ["a", "c"],
        avail_partial: { b: [["05:00", "17:00"]] },
      },
    };
    const m = computePlanWorkloadMetrics(assignments, 1, 3, baseOpts({ soldiersByDay }));
    expect(m.totalCapacityHours).toBe(60);
    expect(m.loadFactor).toBeCloseTo(4 / 60);
  });

  it("scopes work and capacity to dayFilter", () => {
    const assignments = [
      assignment({ day: 0, soldier_idx: 0, raw_hours: 4 }),
      assignment({ day: 1, soldier_idx: 1, raw_hours: 8 }),
    ];
    const soldiersByDay: Record<string, PlanDaySoldiersDoc> = {
      [anchor]: { avail_full: ["a", "b", "c"] },
      "2026-06-02": { avail_full: ["a", "b", "c"] },
    };
    const m = computePlanWorkloadMetrics(assignments, 2, 3, baseOpts({ soldiersByDay, dayFilter: 0 }));
    expect(m.totalWorkHours).toBe(4);
    expect(m.totalCapacityHours).toBe(72);
  });

  it("matches badge counts for 51/29 availability (306 h duty → ~25% load)", () => {
    const assignments = [assignment({ day: 0, soldier_idx: 0, raw_hours: 306 })];
    const soldiersByDay: Record<string, PlanDaySoldiersDoc> = {
      [anchor]: {
        avail_full: Array.from({ length: 80 }, (_, i) => `s${i}`),
        summary: { full: 51, absent_full: 29, absent_partial: 0 },
      },
    };
    const m = computePlanWorkloadMetrics(
      assignments,
      1,
      80,
      baseOpts({ soldierIds: Array.from({ length: 80 }, (_, i) => `s${i}`), soldiersByDay }),
    );
    expect(m.totalCapacityHours).toBe(51 * 24);
    expect(m.totalWorkHours).toBe(306);
    expect(m.loadFactor).toBeCloseTo(306 / (51 * 24));
  });

  it("ignores matrix future-extension spillover in load factor", () => {
    const shiftHours = 4;
    const assignments = [
      assignment({ day: 0, soldier_idx: 0, raw_hours: 4 }),
      assignment({ day: 1, calendar_block: 0, soldier_idx: 0, raw_hours: shiftHours }),
    ];
    const soldiersByDay: Record<string, PlanDaySoldiersDoc> = {
      [anchor]: {
        summary: { full: 51, absent_full: 29, absent_partial: 0 },
      },
    };
    const m = computePlanWorkloadMetrics(assignments, 1, 80, {
      ...baseOpts({ soldierIds: Array.from({ length: 80 }, (_, i) => `s${i}`), soldiersByDay }),
      shiftHours,
    });
    expect(m.totalWorkHours).toBe(4);
    expect(m.totalCapacityHours).toBe(51 * 24);
  });
});

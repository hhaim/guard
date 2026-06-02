import { describe, expect, it } from "vitest";
import { buildScheduleStats, type ZoneReportView } from "./scheduleReport";
import type { ScheduleAssignment } from "./planDoc";

const stubZone = (): ZoneReportView => ({
  shiftHours: 4,
  blocksPerDay: 6,
  slotsPerBlock: 1,
  locNames: ["L0"],
  locIds: ["l0"],
  locWeights: [1],
  locTypeIds: [""],
  typeWeightMult: {},
  typeHoursFactor: {},
  slotLabels: ["S1"],
  slotLocIndices: [0],
  slotTypeIds: [""],
  disabledWeekdays: {},
  timeNames: ["T0"],
  timeWeights: [1],
  timeFromMin: [0],
  timeToExclMin: [240],
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
});

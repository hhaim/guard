import { describe, expect, it } from "vitest";
import { DEFAULT_ZONES, type ZonesDoc } from "./zones";
import { scheduleDayCount, scheduleRowsToAssignments, type ScheduleReportRow } from "./scheduleRows";

const zones: ZonesDoc = {
  ...DEFAULT_ZONES,
  shift_hours: 4,
  slots: [
    { location_id: "loc_gate", name: "g1", full_name: "g1" },
    { location_id: "loc_gate", name: "g2", full_name: "g2" },
    { location_id: "loc_gate", name: "g3", full_name: "g3" },
    { location_id: "loc_gate", name: "g4", full_name: "g4" },
  ],
};

const soldierIds = ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11"];

function row(
  ts: string,
  shift: number,
  slot: string,
  soldier: string,
  dayIndex = 1
): ScheduleReportRow {
  return {
    ts_date: `${ts}T00:00:00Z`,
    day_index: dayIndex,
    slot,
    shift_index: shift,
    shift_start: "00:00:00",
    shift_end: "04:00:00",
    soldier_id: soldier,
    meta: { kind: "rotating", loc_i: 0, time_j: 0, weight: 1, raw_hours: 4 },
  };
}

describe("scheduleRowsToAssignments", () => {
  it("maps legacy <nil> slots to distinct column indices per shift", () => {
    const rows: ScheduleReportRow[] = [
      row("2026-05-21", 0, "<nil>", "s0"),
      row("2026-05-21", 0, "<nil>", "s1"),
      row("2026-05-21", 0, "<nil>", "s3"),
      row("2026-05-21", 0, "<nil>", "s2"),
    ];
    const assignments = scheduleRowsToAssignments(rows, zones, soldierIds);
    const slots = new Set(assignments.map((a) => a.slot));
    expect(slots.size).toBe(4);
    expect(assignments.every((a) => a.calendar_block === 0)).toBe(true);
  });

  it("uses calendar span for multiple dates in range", () => {
    const rows: ScheduleReportRow[] = [
      row("2026-05-20", 0, "g1", "s0", 1),
      row("2026-05-21", 0, "g1", "s1", 1),
      row("2026-05-22", 0, "g1", "s2", 1),
    ];
    const assignments = scheduleRowsToAssignments(rows, zones, soldierIds);
    expect(scheduleDayCount(rows, assignments)).toBe(3);
    expect(new Set(assignments.map((a) => a.day))).toEqual(new Set([0, 1, 2]));
  });
});

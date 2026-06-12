import { describe, expect, it } from "vitest";
import type { PlanDaySoldiersDoc, ScheduleAssignment } from "./planDoc";
import {
  buildBusyTensor,
  buildTimelineLanes,
  filterOnDutyTimelineLanes,
  reportFutureExtensionBlocks,
  timelineSegmentClassName,
  timelineSegmentKind,
  type TimelineLane,
} from "./scheduleReport";

const anchor = "2026-06-01";
const planDayStartHour = 5;
const blockHours = 4;
const blocksPd = 6;

function assignment(
  partial: Partial<ScheduleAssignment> & Pick<ScheduleAssignment, "day" | "soldier_idx">,
): ScheduleAssignment {
  return {
    calendar_block: 0,
    start_hour: 5,
    slot: 0,
    loc_i: 0,
    time_j: 0,
    weight: blockHours,
    raw_hours: blockHours,
    ...partial,
  };
}

function lane(soldierIdx: number, segments: TimelineLane["segments"]): TimelineLane {
  return { soldierIdx, label: `S${soldierIdx}`, segments };
}

describe("reportFutureExtensionBlocks", () => {
  it("matches Python parity for 4h and 8h shifts", () => {
    expect(reportFutureExtensionBlocks(4)).toBe(2);
    expect(reportFutureExtensionBlocks(8)).toBe(1);
  });

  it("caps at two shifts and twelve hours", () => {
    expect(reportFutureExtensionBlocks(3)).toBe(2);
    expect(reportFutureExtensionBlocks(6)).toBe(2);
    expect(reportFutureExtensionBlocks(12)).toBe(1);
  });
});

describe("buildTimelineLanes", () => {
  it("classifies off, unavailable, duty, and full-day segments", () => {
    const assignments: ScheduleAssignment[] = [
      assignment({ day: 0, soldier_idx: 0, calendar_block: 0 }),
      assignment({ day: 0, soldier_idx: 1, calendar_block: 1, kind: "full_day", linear_busy_span_blocks: 6 }),
    ];
    const busy = buildBusyTensor(assignments, 1, 3, blocksPd, true);
    const soldiersByDay: Record<string, PlanDaySoldiersDoc> = {
      [anchor]: { avail_absent: ["soldier-2"] },
    };
    const lanes = buildTimelineLanes(busy, blockHours, 3, planDayStartHour, {
      soldierIds: ["soldier-0", "soldier-1", "soldier-2"],
      anchorDate: anchor,
      soldiersByDay,
      assignments,
    });

    const s0 = lanes.find((l) => l.soldierIdx === 0)!;
    const s1 = lanes.find((l) => l.soldierIdx === 1)!;
    const s2 = lanes.find((l) => l.soldierIdx === 2)!;

    expect(timelineSegmentKind(s0.segments[0]!)).toBe("duty");
    expect(timelineSegmentClassName(s0.segments[0]!)).toContain("sched-seg-on");
    expect(timelineSegmentKind(s0.segments[1]!)).toBe("off");
    expect(timelineSegmentClassName(s0.segments[1]!)).toContain("sched-seg-off");

    expect(timelineSegmentKind(s1.segments[1]!)).toBe("full_day_duty");
    expect(timelineSegmentClassName(s1.segments[1]!)).toContain("sched-seg-full-day");

    expect(timelineSegmentKind(s2.segments[0]!)).toBe("unavailable");
    expect(timelineSegmentClassName(s2.segments[0]!)).toContain("sched-seg-unavail");
  });

  it("adds extension blocks after the last plan day", () => {
    const assignments: ScheduleAssignment[] = [
      assignment({
        day: 1,
        soldier_idx: 0,
        calendar_block: 0,
        linear_busy_span_blocks: 1,
      }),
    ];
    const busy = buildBusyTensor(assignments, 1, 1, blocksPd, true);
    const lanes = buildTimelineLanes(busy, blockHours, 1, planDayStartHour, {
      soldierIds: ["a"],
      anchorDate: anchor,
      assignments,
    });
    const segs = lanes[0]!.segments;
    expect(segs).toHaveLength(blocksPd + reportFutureExtensionBlocks(blockHours));
    const extStart = segs[blocksPd]!.startHour;
    expect(extStart).toBe(24 + planDayStartHour);
    expect(segs[blocksPd]!.onDuty).toBe(true);
  });
});

describe("filterOnDutyTimelineLanes", () => {
  it("drops green-only, yellow-only, and green+yellow lanes", () => {
    const offOnly = lane(0, [{ startHour: 0, duration: 4, onDuty: false }]);
    const unavailOnly = lane(1, [{ startHour: 0, duration: 4, onDuty: false, unavailable: true }]);
    const mixedNoDuty = lane(2, [
      { startHour: 0, duration: 4, onDuty: false },
      { startHour: 4, duration: 4, onDuty: false, unavailable: true },
    ]);
    const withDuty = lane(3, [
      { startHour: 0, duration: 4, onDuty: false },
      { startHour: 4, duration: 4, onDuty: true },
    ]);
    const fullDay = lane(4, [{ startHour: 0, duration: 4, onDuty: true, fullDayDuty: true }]);

    const filtered = filterOnDutyTimelineLanes([offOnly, unavailOnly, mixedNoDuty, withDuty, fullDay]);
    expect(filtered.map((l) => l.soldierIdx)).toEqual([3, 4]);
  });
});

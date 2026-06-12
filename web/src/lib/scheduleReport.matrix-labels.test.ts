import { describe, expect, it } from "vitest";
import { planDayTitle } from "./planDay";
import { formatBlockWindowWithShift } from "./scheduleReport";

describe("matrix expert-rule labels", () => {
  it("uses 0-based day title without schedule matrix suffix", () => {
    expect(planDayTitle(0, "2026-06-06", 5)).toBe("Day 0  Saturday, 2026-06-06");
  });

  it("appends 0-based shift_id to row window", () => {
    expect(formatBlockWindowWithShift(5, 4, 0)).toBe("05:00–09:00(0)");
    expect(formatBlockWindowWithShift(9, 4, 1)).toBe("09:00–13:00(1)");
  });
});

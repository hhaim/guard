import { describe, expect, it } from "vitest";
import { nowFakeUtcIso, todayFakeUtcDate, tomorrowFakeUtcDate } from "./wallClock";

describe("wallClock", () => {
  it("reinterprets Jerusalem wall clock as UTC without conversion", () => {
    // 2026-06-03 14:30:45 in Jerusalem → stored as 14:30:45Z (not converted to true UTC)
    const fixed = new Date("2026-06-03T11:30:45.000Z"); // 14:30 Jerusalem (UTC+3)
    expect(nowFakeUtcIso(fixed)).toBe("2026-06-03T14:30:45.000Z");
    expect(todayFakeUtcDate(fixed)).toBe("2026-06-03");
  });

  it("tomorrowFakeUtcDate advances fake-UTC calendar day", () => {
    const fixed = new Date("2026-06-03T11:30:45.000Z");
    expect(tomorrowFakeUtcDate(fixed)).toBe("2026-06-04");
  });
});

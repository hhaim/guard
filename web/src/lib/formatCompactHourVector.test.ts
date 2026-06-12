import { describe, expect, it } from "vitest";
import { compactVectorTotalHours, formatCompactHourVector } from "./formatCompactHourVector";

describe("formatCompactHourVector", () => {
  it("returns [] when all zero", () => {
    expect(formatCompactHourVector([0, 0, 0, 0, 0])).toBe("[]");
  });

  it("includes only positive entries with 1-based index", () => {
    expect(formatCompactHourVector([0, 0, 0, 7.9, 0])).toBe("[4:7.9]");
  });

  it("joins multiple positives", () => {
    expect(formatCompactHourVector([0, 3.5, 0, 0, 0, 0, 0, 7.9])).toBe("[2:3.5, 8:7.9]");
  });
});

describe("compactVectorTotalHours", () => {
  it("sums positive hours", () => {
    expect(compactVectorTotalHours([0, 3.5, 0, 7.9])).toBe(11.4);
  });
});

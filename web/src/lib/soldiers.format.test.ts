import { describe, expect, it } from "vitest";
import { formatSoldierShortId } from "./soldiers";

describe("formatSoldierShortId", () => {
  it("zero-pads numeric roster ids", () => {
    expect(formatSoldierShortId("s1")).toBe("S01");
    expect(formatSoldierShortId("s45")).toBe("S45");
    expect(formatSoldierShortId("S0")).toBe("S00");
  });

  it("falls back to padded index when id is empty", () => {
    expect(formatSoldierShortId("", 1)).toBe("S01");
    expect(formatSoldierShortId("", 45)).toBe("S45");
  });
});

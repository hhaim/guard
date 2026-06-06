import { describe, expect, it } from "vitest";
import {
  stackedBarRowPctSum,
  stackedBarScaleMax,
  stackedBarSegmentPct,
} from "./stackedBarScale";

describe("stackedBarScale", () => {
  it("uses global max so bar length reflects total hours", () => {
    const scaleMax = stackedBarScaleMax([8, 40]);
    expect(scaleMax).toBe(40);
    expect(stackedBarRowPctSum([5, 3], scaleMax)).toBeCloseTo(20, 5);
    expect(stackedBarRowPctSum([20, 20], scaleMax)).toBeCloseTo(100, 5);
  });

  it("stacks segment widths proportionally on shared scale", () => {
    const scaleMax = 40;
    expect(stackedBarSegmentPct(10, scaleMax)).toBeCloseTo(25, 5);
    expect(stackedBarSegmentPct(10, scaleMax) + stackedBarSegmentPct(30, scaleMax)).toBeCloseTo(100, 5);
  });
});

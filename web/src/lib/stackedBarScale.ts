export const STACKED_BAR_EPS = 1e-9;

/** Max stacked total across rows — shared scale for comparable bar lengths. */
export function stackedBarScaleMax(rowTotals: number[]): number {
  const max = rowTotals.length ? Math.max(...rowTotals) : 0;
  return Math.max(max, STACKED_BAR_EPS);
}

/** Segment width as % of track using a shared hours scale (not normalized per row). */
export function stackedBarSegmentPct(hours: number, scaleMax: number): number {
  if (hours <= STACKED_BAR_EPS) return 0;
  return (100 * hours) / Math.max(scaleMax, STACKED_BAR_EPS);
}

/** Sum of segment widths for a row on the shared scale. */
export function stackedBarRowPctSum(segmentHours: number[], scaleMax: number): number {
  return segmentHours.reduce((sum, h) => sum + stackedBarSegmentPct(h, scaleMax), 0);
}

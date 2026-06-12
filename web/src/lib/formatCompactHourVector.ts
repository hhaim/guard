const EPS = 1e-9;

export type CompactHourVectorOpts = {
  /** Decimal places for hours (default 1). */
  decimals?: number;
};

/** Format hours array as compact `[i:h,…]` or `[]` (1-based index, positive only). */
export function formatCompactHourVector(
  hours: number[],
  opts?: CompactHourVectorOpts,
): string {
  const decimals = opts?.decimals ?? 1;
  const parts: string[] = [];
  for (let i = 0; i < hours.length; i++) {
    const h = hours[i];
    if (h <= EPS) continue;
    const rounded = Math.round(h * 10 ** decimals) / 10 ** decimals;
    parts.push(`${i + 1}:${rounded.toFixed(decimals)}`);
  }
  if (parts.length === 0) return "[]";
  return `[${parts.join(", ")}]`;
}

/** Sum of positive hours in vector (for tooltip `t:` line). */
export function compactVectorTotalHours(hours: number[]): number {
  let sum = 0;
  for (const h of hours) {
    if (h > EPS) sum += h;
  }
  return Math.round(sum * 10) / 10;
}

import type { Soldier } from "./soldiers";

/** Readable badge colors (background + text) for soldier cells. */
export const SOLDIER_BADGE_COLORS: ReadonlyArray<{ bg: string; fg: string }> = [
  { bg: "#dbeafe", fg: "#1e3a8a" },
  { bg: "#fce7f3", fg: "#831843" },
  { bg: "#d1fae5", fg: "#065f46" },
  { bg: "#ffedd5", fg: "#9a3412" },
  { bg: "#e9d5ff", fg: "#581c87" },
  { bg: "#ccfbf1", fg: "#134e4a" },
  { bg: "#fef3c7", fg: "#78350f" },
  { bg: "#e0e7ff", fg: "#312e81" },
  { bg: "#fecdd3", fg: "#881337" },
  { bg: "#cffafe", fg: "#155e75" },
  { bg: "#f3f4f6", fg: "#1f2937" },
  { bg: "#fde68a", fg: "#713f12" },
];

export type SoldierDisplay = {
  count: number;
  shortLabel: (idx: number) => string;
  fullLabel: (idx: number) => string;
  badgeStyle: (idx: number) => { backgroundColor: string; color: string };
};

export function buildSoldierDisplay(
  soldierIds: string[],
  soldiers: Soldier[],
  soldierCount: number
): SoldierDisplay {
  const byId = new Map(soldiers.map((s) => [s.id, s]));
  const count = Math.max(soldierCount, soldierIds.length);

  const shortLabel = (idx: number) => `S${idx}`;
  const fullLabel = (idx: number) => {
    const id = soldierIds[idx];
    const s = id ? byId.get(id) : undefined;
    const name = s?.full_name?.trim();
    if (name) return name;
    if (id) return id;
    return shortLabel(idx);
  };
  const badgeStyle = (idx: number) => {
    const c = SOLDIER_BADGE_COLORS[idx % SOLDIER_BADGE_COLORS.length];
    return { backgroundColor: c.bg, color: c.fg };
  };

  return { count, shortLabel, fullLabel, badgeStyle };
}

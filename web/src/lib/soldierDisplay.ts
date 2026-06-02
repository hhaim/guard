import type { PlatoonColorEntry } from "./platoonColors";
import { platoonBadgeStyle } from "./platoonColors";
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

export type PlatoonStyle = { backgroundColor: string; color: string };

export type SoldierDisplay = {
  count: number;
  shortLabel: (idx: number) => string;
  fullLabel: (idx: number) => string;
  /** Badge / avatar fill (platoon background + contrasting text). */
  badgeStyle: (idx: number) => PlatoonStyle;
  /** Matrix cell background — platoon color only. */
  matrixCellStyle: (idx: number) => { backgroundColor: string };
  /** Matrix soldier label on colored cell (transparent badge). */
  matrixBadgeStyle: (idx: number) => PlatoonStyle;
};

/** Debug audit for platoon badge/cell color hypotheses (session 35b199). */
export function auditPlatoonColorResolution(
  soldierIds: string[],
  soldiers: Soldier[],
  soldierCount: number,
  platoonColors: PlatoonColorEntry[]
) {
  const byId = new Map(soldiers.map((s) => [s.id, s]));
  const count = Math.max(soldierCount, soldierIds.length);
  const samples: {
    idx: number;
    id: string | null;
    platoon_code: string | null;
    hasSoldierRecord: boolean;
    platoonColorConfigured: boolean;
    bg: string;
    source: "configured" | "fallback" | "no_platoon";
  }[] = [];
  for (let idx = 0; idx < Math.min(count, 16); idx++) {
    const id = soldierIds[idx] ?? null;
    const s = id ? byId.get(id) : undefined;
    const pc = s?.platoon_code?.trim() ?? "";
    let source: "configured" | "fallback" | "no_platoon" = "no_platoon";
    let platoonColorConfigured = false;
    if (pc) {
      platoonColorConfigured = platoonColors.some((x) => x.code === pc);
      source = platoonColorConfigured ? "configured" : "fallback";
    }
    const style =
      pc && source !== "no_platoon"
        ? platoonBadgeStyle(pc, platoonColors)
        : {
            backgroundColor: SOLDIER_BADGE_COLORS[idx % SOLDIER_BADGE_COLORS.length].bg,
            color: SOLDIER_BADGE_COLORS[idx % SOLDIER_BADGE_COLORS.length].fg,
          };
    const bg = style.backgroundColor;
    samples.push({
      idx,
      id,
      platoon_code: pc || null,
      hasSoldierRecord: Boolean(s),
      platoonColorConfigured,
      bg: typeof bg === "string" ? bg : String(bg),
      source,
    });
  }
  return {
    platoonColorsCount: platoonColors.length,
    platoonColorCodes: platoonColors.map((c) => c.code),
    soldierIdsLen: soldierIds.length,
    soldiersWithPlatoon: soldiers.filter((s) => s.platoon_code?.trim()).length,
    soldierCount: count,
    samples,
  };
}

export function buildSoldierDisplay(
  soldierIds: string[],
  soldiers: Soldier[],
  soldierCount: number,
  platoonColors: PlatoonColorEntry[] = []
): SoldierDisplay {
  const byId = new Map(soldiers.map((s) => [s.id, s]));
  const count = Math.max(soldierCount, soldierIds.length);

  const shortLabel = (idx: number) => {
    const id = soldierIds[idx];
    if (id) return id;
    return `S${idx}`;
  };
  const fullLabel = (idx: number) => {
    const id = soldierIds[idx];
    const s = id ? byId.get(id) : undefined;
    const name = s?.full_name?.trim();
    if (name) return name;
    if (id) return id;
    return shortLabel(idx);
  };
  const platoonStyleForIdx = (idx: number): PlatoonStyle => {
    const id = soldierIds[idx];
    const s = id ? byId.get(id) : undefined;
    const pc = s?.platoon_code?.trim();
    if (pc) {
      return platoonBadgeStyle(pc, platoonColors);
    }
    const c = SOLDIER_BADGE_COLORS[idx % SOLDIER_BADGE_COLORS.length];
    return { backgroundColor: c.bg, color: c.fg };
  };

  const badgeStyle = platoonStyleForIdx;
  const matrixCellStyle = (idx: number) => ({
    backgroundColor: platoonStyleForIdx(idx).backgroundColor,
  });
  const matrixBadgeStyle = (idx: number): PlatoonStyle => {
    const st = platoonStyleForIdx(idx);
    return { backgroundColor: "transparent", color: st.color };
  };

  return { count, shortLabel, fullLabel, badgeStyle, matrixCellStyle, matrixBadgeStyle };
}

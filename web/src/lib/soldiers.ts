import { type SoldierPlatoonsDoc, platoonByCode } from "./soldierPlatoons";
import { type SoldierTypesDoc, typeByCode } from "./soldierTypes";

export type Soldier = {
  id: string;
  key?: string;
  full_name: string;
  type_code?: string;
  platoon_code?: string;
  /** @deprecated use status board entries; read-only from legacy cfg */
  state?: string;
};

export type SoldiersDoc = {
  update_ts?: string;
  soldiers: Soldier[];
};

export const SOLDIER_STATES = [
  { value: "base", label: "On base" },
  { value: "leave", label: "Leave" },
  { value: "training", label: "Training" },
  { value: "sick", label: "Sick" },
  { value: "other", label: "Other" },
] as const;

/** Next default id s0, s1, … from max numeric suffix in existing ids (supports s12, etc.). */
export function nextSoldierId(soldiers: Soldier[]): string {
  let max = -1;
  for (const s of soldiers) {
    const m = /^s(\d+)$/i.exec(s.id.trim());
    if (m) max = Math.max(max, Number.parseInt(m[1], 10));
  }
  return `s${max + 1}`;
}

export function emptySoldier(soldiers: Soldier[]): Soldier {
  return {
    id: nextSoldierId(soldiers),
    full_name: "",
  };
}

/** Roster index for a soldier id, or -1 if not on the roster. */
export function rosterIndexForId(soldierIds: string[], soldierId: string): number {
  const id = soldierId.trim();
  if (!id) return -1;
  return soldierIds.findIndex((x) => x === id);
}

function normalizeSoldier(raw: Record<string, unknown>): Soldier {
  const id = String(raw.id ?? raw.key ?? "").trim();
  const key = raw.key != null ? String(raw.key).trim() : undefined;
  return {
    id,
    ...(key ? { key } : {}),
    full_name: String(raw.full_name ?? "").trim(),
    ...(raw.state != null && String(raw.state).trim()
      ? { state: String(raw.state).trim() }
      : {}),
    ...(raw.type_code != null && String(raw.type_code).trim()
      ? { type_code: String(raw.type_code).trim() }
      : {}),
    ...((): { platoon_code?: string } => {
      const fromCode = raw.platoon_code != null ? String(raw.platoon_code).trim() : "";
      if (fromCode) return { platoon_code: fromCode };
      if (raw.platoon != null && String(raw.platoon).trim()) {
        return { platoon_code: String(raw.platoon).trim() };
      }
      return {};
    })(),
  };
}

export function docFromServer(value: unknown): SoldiersDoc {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { soldiers: [] };
  }
  const o = value as Record<string, unknown>;
  const list = Array.isArray(o.soldiers) ? o.soldiers : [];
  return {
    update_ts: o.update_ts != null ? String(o.update_ts) : undefined,
    soldiers: list
      .filter((x): x is Record<string, unknown> => x != null && typeof x === "object" && !Array.isArray(x))
      .map(normalizeSoldier)
      .filter((s) => s.id !== ""),
  };
}

export function deriveJsonFromDoc(doc: SoldiersDoc): Record<string, unknown> {
  return {
    update_ts: doc.update_ts ?? new Date().toISOString(),
    soldiers: doc.soldiers.map((s) => {
      const row: Record<string, string> = {
        id: s.id,
        full_name: s.full_name,
      };
      if (s.key && s.key !== s.id) row.key = s.key;
      if (s.type_code?.trim()) row.type_code = s.type_code.trim();
      if (s.platoon_code?.trim()) row.platoon_code = s.platoon_code.trim();
      return row;
    }),
  };
}

export function parseDocFromJson(raw: unknown): SoldiersDoc {
  return docFromServer(raw);
}

/** Avatar label from soldier ID only (e.g. s12 → S12). */
export function soldierInitials(s: Soldier): string {
  return formatSoldierShortId(s.id.trim());
}

/** Compact aligned roster label (s1 → S01, s45 → S45). */
export function formatSoldierShortId(id: string, fallbackIdx?: number): string {
  const rawId = id.trim();
  const numericId = /^s(\d+)$/i.exec(rawId);
  if (numericId) {
    const n = Number.parseInt(numericId[1], 10);
    return `S${String(n).padStart(2, "0")}`;
  }
  if (rawId) return rawId.toUpperCase();
  if (fallbackIdx != null) return `S${String(fallbackIdx).padStart(2, "0")}`;
  return "?";
}

export function sortSoldiers(list: Soldier[]): Soldier[] {
  return [...list].sort((a, b) => {
    const na = a.full_name.trim() || a.id;
    const nb = b.full_name.trim() || b.id;
    return na.localeCompare(nb, undefined, { sensitivity: "base" });
  });
}

export function validateDoc(
  doc: SoldiersDoc,
  types?: SoldierTypesDoc,
  platoons?: SoldierPlatoonsDoc
): string | null {
  const ids = new Set<string>();
  for (const s of doc.soldiers) {
    if (!s.id.trim()) return "Every soldier needs an ID.";
    if (ids.has(s.id)) return `Duplicate soldier ID: ${s.id}`;
    ids.add(s.id);
    const tc = s.type_code?.trim();
    if (tc && types && !typeByCode(types, tc)) {
      return `Soldier ${s.id}: unknown type_code "${tc}"`;
    }
    const pc = s.platoon_code?.trim();
    if (pc && platoons && !platoonByCode(platoons, pc)) {
      return `Soldier ${s.id}: unknown platoon_code "${pc}"`;
    }
  }
  return null;
}

/** Most frequent type_code in roster (for hiding common type badges in schedule matrix). */
export function dominantSoldierTypeCode(soldiers: Soldier[]): string | null {
  const counts = new Map<string, number>();
  for (const s of soldiers) {
    const code = s.type_code?.trim();
    if (!code) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  let best = "";
  let bestN = 0;
  for (const [code, n] of counts) {
    if (n > bestN) {
      bestN = n;
      best = code;
    }
  }
  return bestN > 0 ? best : null;
}

export type Soldier = {
  id: string;
  key?: string;
  full_name: string;
  state: string;
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

export function emptySoldier(index: number): Soldier {
  return {
    id: `s${index}`,
    full_name: "",
    state: "base",
  };
}

function normalizeSoldier(raw: Record<string, unknown>): Soldier {
  const id = String(raw.id ?? raw.key ?? "").trim();
  const key = raw.key != null ? String(raw.key).trim() : undefined;
  return {
    id,
    ...(key ? { key } : {}),
    full_name: String(raw.full_name ?? "").trim(),
    state: String(raw.state ?? "base").trim() || "base",
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
        state: s.state || "base",
      };
      if (s.key && s.key !== s.id) row.key = s.key;
      return row;
    }),
  };
}

export function parseDocFromJson(raw: unknown): SoldiersDoc {
  return docFromServer(raw);
}

export function soldierInitials(s: Soldier): string {
  const name = s.full_name.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  return (s.id || "?").slice(0, 2).toUpperCase();
}

export function sortSoldiers(list: Soldier[]): Soldier[] {
  return [...list].sort((a, b) => {
    const na = a.full_name.trim() || a.id;
    const nb = b.full_name.trim() || b.id;
    return na.localeCompare(nb, undefined, { sensitivity: "base" });
  });
}

export function validateDoc(doc: SoldiersDoc): string | null {
  const ids = new Set<string>();
  for (const s of doc.soldiers) {
    if (!s.id.trim()) return "Every soldier needs an ID.";
    if (ids.has(s.id)) return `Duplicate soldier ID: ${s.id}`;
    ids.add(s.id);
  }
  return null;
}

export type SoldierType = {
  code: string;
  label: string;
};

export type SoldierTypesDoc = {
  update_ts?: string;
  types: SoldierType[];
};

export function nextTypeCode(types: SoldierType[]): string {
  const used = new Set(types.map((t) => t.code.trim()));
  for (let i = 0; i < 26; i++) {
    const c = String.fromCharCode(65 + i);
    if (!used.has(c)) return c;
  }
  return `T${types.length}`;
}

export function emptyType(types: SoldierType[]): SoldierType {
  return { code: nextTypeCode(types), label: "" };
}

function normalizeType(raw: Record<string, unknown>): SoldierType {
  return {
    code: String(raw.code ?? "").trim(),
    label: String(raw.label ?? "").trim(),
  };
}

export function docFromServer(value: unknown): SoldierTypesDoc {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { types: [] };
  }
  const o = value as Record<string, unknown>;
  const list = Array.isArray(o.types) ? o.types : [];
  return {
    update_ts: o.update_ts != null ? String(o.update_ts) : undefined,
    types: list
      .filter((x): x is Record<string, unknown> => x != null && typeof x === "object" && !Array.isArray(x))
      .map(normalizeType)
      .filter((t) => t.code !== ""),
  };
}

export function deriveJsonFromDoc(doc: SoldierTypesDoc): Record<string, unknown> {
  return {
    update_ts: doc.update_ts ?? new Date().toISOString(),
    types: doc.types.map((t) => ({ code: t.code, label: t.label })),
  };
}

export function parseDocFromJson(raw: unknown): SoldierTypesDoc {
  return docFromServer(raw);
}

export function typeByCode(doc: SoldierTypesDoc, code: string): SoldierType | undefined {
  const c = code.trim();
  if (!c) return undefined;
  return doc.types.find((t) => t.code === c);
}

export function typeLabel(doc: SoldierTypesDoc, code: string): string {
  return typeByCode(doc, code)?.label ?? "";
}

export function validateDoc(doc: SoldierTypesDoc): string | null {
  const codes = new Set<string>();
  for (const t of doc.types) {
    if (!t.code) return "Every type needs a code.";
    if (t.code.length > 4) return `Type code "${t.code}" must be 1–4 characters.`;
    if (codes.has(t.code)) return `Duplicate type code: ${t.code}`;
    codes.add(t.code);
    if (!t.label.trim()) return `Type "${t.code}" needs a label.`;
  }
  return null;
}

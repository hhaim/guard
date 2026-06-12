export type Platoon = {
  code: string;
  label: string;
};

export type SoldierPlatoonsDoc = {
  update_ts?: string;
  platoons: Platoon[];
};

export function nextPlatoonCode(platoons: Platoon[]): string {
  const used = new Set(platoons.map((p) => p.code.trim()));
  for (let n = 1; n <= 99; n++) {
    const c = String(n);
    if (!used.has(c)) return c;
  }
  return `P${platoons.length}`;
}

export function emptyPlatoon(platoons: Platoon[]): Platoon {
  return { code: nextPlatoonCode(platoons), label: "" };
}

function normalizePlatoon(raw: Record<string, unknown>): Platoon {
  const codeRaw = raw.code ?? raw.code_id;
  return {
    code: String(codeRaw ?? "").trim(),
    label: String(raw.label ?? raw.name ?? "").trim(),
  };
}

export function docFromServer(value: unknown): SoldierPlatoonsDoc {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { platoons: [] };
  }
  const o = value as Record<string, unknown>;
  const list = Array.isArray(o.platoons) ? o.platoons : [];
  return {
    update_ts: o.update_ts != null ? String(o.update_ts) : undefined,
    platoons: list
      .filter((x): x is Record<string, unknown> => x != null && typeof x === "object" && !Array.isArray(x))
      .map(normalizePlatoon)
      .filter((p) => p.code !== ""),
  };
}

export function deriveJsonFromDoc(doc: SoldierPlatoonsDoc): Record<string, unknown> {
  return {
    update_ts: doc.update_ts ?? new Date().toISOString(),
    platoons: doc.platoons.map((p) => ({ code: p.code, label: p.label })),
  };
}

export function parseDocFromJson(raw: unknown): SoldierPlatoonsDoc {
  return docFromServer(raw);
}

export function platoonByCode(doc: SoldierPlatoonsDoc, code: string): Platoon | undefined {
  const c = code.trim();
  if (!c) return undefined;
  return doc.platoons.find((p) => p.code === c);
}

export function platoonLabel(doc: SoldierPlatoonsDoc, code: string): string {
  return platoonByCode(doc, code)?.label ?? "";
}

export function collectUsedPlatoonCodes(
  soldiers: ReadonlyArray<{ platoon_code?: string }>
): Set<string> {
  return new Set(
    soldiers
      .map((s) => s.platoon_code?.trim())
      .filter((code): code is string => Boolean(code))
  );
}

export function validateDoc(doc: SoldierPlatoonsDoc): string | null {
  const codes = new Set<string>();
  for (const p of doc.platoons) {
    if (!p.code) return "Every platoon needs a code.";
    if (p.code.length > 4) return `Platoon code "${p.code}" must be 1–4 characters.`;
    if (codes.has(p.code)) return `Duplicate platoon code: ${p.code}`;
    codes.add(p.code);
    if (!p.label.trim()) return `Platoon "${p.code}" needs a label.`;
  }
  return null;
}

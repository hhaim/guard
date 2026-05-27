import YAML from "yaml";
import { docFromServer as soldiersFromRaw, parseDocFromJson, validateDoc as validateSoldiers, type SoldiersDoc } from "./soldiers";
import {
  docFromServer as typesFromRaw,
  validateDoc as validateTypes,
  type SoldierTypesDoc,
} from "./soldierTypes";
import { parseStatusBlock, type SoldierStatusYamlDoc } from "./rosterStatusYaml";

export type RosterYamlImport = {
  typesDoc?: SoldierTypesDoc;
  soldiersDoc?: SoldiersDoc;
  statusDoc?: SoldierStatusYamlDoc;
};

const ROSTER_SCHEMA_VERSION = 2;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function parseTypesBlock(raw: unknown): SoldierTypesDoc {
  const block = asRecord(raw);
  if (!block) return { types: [] };
  if (Array.isArray(block.types)) {
    return typesFromRaw({ types: block.types });
  }
  return typesFromRaw(block);
}

function parseSoldiersList(raw: unknown): SoldiersDoc {
  if (Array.isArray(raw)) {
    return soldiersFromRaw({ soldiers: raw });
  }
  return soldiersFromRaw(raw);
}

export function parseRosterYaml(text: string): RosterYamlImport {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("YAML file is empty");
  }
  const root = YAML.parse(trimmed) as unknown;
  const raw = asRecord(root);
  if (!raw) {
    throw new Error("YAML root must be a mapping");
  }

  const version = raw.schema_version != null ? Number(raw.schema_version) : ROSTER_SCHEMA_VERSION;
  if (version !== 1 && version !== ROSTER_SCHEMA_VERSION) {
    throw new Error(`Unsupported schema_version: ${String(raw.schema_version)} (expected 1 or ${ROSTER_SCHEMA_VERSION})`);
  }

  const hasTypes = raw.soldier_types != null;
  const hasSoldiers = raw.soldiers != null;
  const hasStatus = raw.soldier_status != null;

  if (!hasTypes && !hasSoldiers && !hasStatus) {
    throw new Error("YAML must include soldier_types, soldiers, and/or soldier_status");
  }

  const out: RosterYamlImport = {};

  if (hasTypes) {
    const typesDoc = parseTypesBlock(raw.soldier_types);
    const err = validateTypes(typesDoc);
    if (err) throw new Error(err);
    out.typesDoc = typesDoc;
  }

  if (hasSoldiers) {
    const soldiersDoc = parseSoldiersList(raw.soldiers);
    const err = validateSoldiers(soldiersDoc, out.typesDoc);
    if (err) throw new Error(err);
    out.soldiersDoc = soldiersDoc;
  } else if (out.typesDoc) {
    const err = validateTypes(out.typesDoc);
    if (err) throw new Error(err);
  }

  if (hasStatus) {
    out.statusDoc = parseStatusBlock(raw.soldier_status);
  }

  return out;
}

export function stringifyRosterYaml(
  typesDoc: SoldierTypesDoc,
  soldiersDoc: SoldiersDoc,
  statusDoc?: SoldierStatusYamlDoc,
): string {
  const obj: Record<string, unknown> = {
    schema_version: ROSTER_SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    soldier_types: {
      types: typesDoc.types.map((t) => ({ code: t.code, label: t.label })),
    },
    soldiers: soldiersDoc.soldiers.map((s) => {
      const row: Record<string, string> = {
        id: s.id,
        full_name: s.full_name,
      };
      if (s.type_code?.trim()) row.type_code = s.type_code.trim();
      return row;
    }),
  };
  if (statusDoc) {
    obj.soldier_status = {
      range: statusDoc.range,
      entries: statusDoc.entries,
    };
  }
  return YAML.stringify(obj, { lineWidth: 0 });
}

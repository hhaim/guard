/** Tokenized expert-rule model: parse, serialize, validate (mirrors guardsched/custom_rules.go). */

export type RuleToken = { id: string; key: string; value: string };
export type RuleRow = { id: string; tokens: RuleToken[] };

export type RuleKeyCategory = "context" | "operation";

export type RuleKeyDef = {
  category: RuleKeyCategory;
  helpTitle: string;
  helpSummary: string;
  helpDetail: string;
  helpExample: string;
};

export const RULE_KEYS = [
  "day",
  "slot",
  "shift",
  "force",
  "not",
  "exclude",
  "pin",
  "force_type",
  "type_remap",
] as const;

export type RuleKey = (typeof RULE_KEYS)[number];

export const OPERATION_KEYS: RuleKey[] = [
  "force",
  "not",
  "exclude",
  "pin",
  "force_type",
  "type_remap",
];

export const CONTEXT_KEYS: RuleKey[] = ["day", "slot", "shift"];

export const EXPERT_RULE_KEY_DEFS: Record<RuleKey, RuleKeyDef> = {
  day: {
    category: "context",
    helpTitle: "Day",
    helpSummary: "0-based plan day from the matrix heading.",
    helpDetail:
      "Use the day number shown in matrix headers (Day 0, Day 1, …). Omit on not/exclude to apply to every planning day.",
    helpExample: "day:0 slot:1 shift:0 not:s1",
  },
  slot: {
    category: "context",
    helpTitle: "Slot",
    helpSummary: "1-based slot id from the matrix column header.",
    helpDetail:
      "Copy from Slot N in the matrix tooltip. Omit on not to mean every slot. exclude does not allow slot.",
    helpExample: "day:0 slot:1 shift:0 not:s1",
  },
  shift: {
    category: "context",
    helpTitle: "Shift",
    helpSummary: "0-based block index from the matrix row label.",
    helpDetail:
      "Omit for full_day, full_day_team, and whole-slot rules. Omit on not to mean every shift.",
    helpExample: "day:0 slot:1 shift:0 not:s1",
  },
  force: {
    category: "operation",
    helpTitle: "Force",
    helpSummary: "Assign a specific soldier to the seat.",
    helpDetail:
      "With Force off (prefer), the simulator uses the soldier only if rest and availability allow. With Force on, assigns anyway and lists conflicts.",
    helpExample: "day:0 slot:1 shift:2 force:s42",
  },
  not: {
    category: "operation",
    helpTitle: "Not (exclude from pool)",
    helpSummary: "Exclude soldiers from the assignment pool for matching day/slot/shift.",
    helpDetail:
      "Comma-separate multiple ids. Omit day, slot, or shift to mean all. Does not change Soldiers status.",
    helpExample: "day:0 slot:1 shift:0 not:s1",
  },
  exclude: {
    category: "operation",
    helpTitle: "Exclude (plan away)",
    helpSummary: "Mark soldiers away for this plan — no assignments.",
    helpDetail:
      "Plan-only global away. Cannot combine with slot or shift; use not for shift-specific blocks. Optional day scopes to one plan day.",
    helpExample: "exclude:s34",
  },
  pin: {
    category: "operation",
    helpTitle: "Pin platoon",
    helpSummary: "Fill full_day_team slot from a specific platoon.",
    helpDetail:
      "Overrides pin_platoon behavior in zones YAML for that slot on the given day.",
    helpExample: "day:0 slot:8 pin:3",
  },
  force_type: {
    category: "operation",
    helpTitle: "Force type",
    helpSummary: "Require soldiers of a roster type for the seat.",
    helpDetail:
      "Works on rotating, windowed, and full_day slots. Omit shift for whole-slot full_day rules.",
    helpExample: "day:0 slot:6 shift:4 force_type:H",
  },
  type_remap: {
    category: "operation",
    helpTitle: "Type remap",
    helpSummary: "Move quota seats between types on full_day_team slots.",
    helpDetail:
      "Format G>H:2 moves 2 seats from type G to type H. Only valid on full_day_team slots.",
    helpExample: "day:0 slot:8 type_remap G>H:2",
  },
};

export type ExpertSuggestions = {
  soldierIds: string[];
  slotIds: string[];
  typeCodes: string[];
  platoonCodes: string[];
  planDays: number;
  maxShift?: number;
};

export type RuleIssueSeverity = "error" | "warn";

export type RuleIssue = {
  tokenId?: string;
  severity: RuleIssueSeverity;
  code: string;
  message: string;
};

let idSeq = 0;
export function newId(prefix: string): string {
  idSeq += 1;
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${idSeq}`;
}

export function isRuleKey(k: string): k is RuleKey {
  return (RULE_KEYS as readonly string[]).includes(k);
}

export function isOperationKey(k: string): boolean {
  return OPERATION_KEYS.includes(k as RuleKey);
}

/** Parse one compact rule line into tokens, preserving source order. */
export function parseRuleLine(line: string): RuleToken[] {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return [];

  const parts = trimmed.split(/\s+/);
  const tokens: RuleToken[] = [];

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];

    if (p === "type_remap") {
      let value = "";
      if (i + 1 < parts.length) {
        const next = parts[i + 1];
        const colon = next.indexOf(":");
        const nextKey = colon > 0 ? next.slice(0, colon) : next;
        if (next.includes(">") || !isRuleKey(nextKey)) {
          value = next;
          i += 1;
        }
      }
      tokens.push({ id: newId("t"), key: "type_remap", value });
      continue;
    }

    const colon = p.indexOf(":");
    if (colon <= 0) continue;
    const key = p.slice(0, colon);
    const value = p.slice(colon + 1);
    if (!isRuleKey(key)) continue;
    tokens.push({ id: newId("t"), key, value });
  }

  return tokens;
}

export function parseRulesText(text: string): RuleRow[] {
  const rows: RuleRow[] = [];
  for (const line of text.split("\n")) {
    const tokens = parseRuleLine(line);
    if (tokens.length === 0) continue;
    rows.push({ id: newId("r"), tokens });
  }
  return rows.length > 0 ? rows : [createBlankRow()];
}

export function serializeToken(token: RuleToken): string {
  if (token.key === "type_remap") {
    return token.value.includes(":") && token.value.includes(">")
      ? `type_remap ${token.value}`
      : `type_remap:${token.value}`;
  }
  return `${token.key}:${token.value}`;
}

export function serializeRuleRow(row: RuleRow): string {
  return row.tokens.map(serializeToken).join(" ");
}

export function serializeRulesText(rows: RuleRow[]): string {
  return rows
    .map(serializeRuleRow)
    .filter((line) => line.trim())
    .join("\n");
}

export function createBlankRow(): RuleRow {
  return {
    id: newId("r"),
    tokens: [{ id: newId("t"), key: "not", value: "" }],
  };
}

export function duplicateRow(row: RuleRow): RuleRow {
  return {
    id: newId("r"),
    tokens: row.tokens.map((t) => ({ ...t, id: newId("t") })),
  };
}

export function rowFromExampleLine(line: string): RuleRow {
  const tokens = parseRuleLine(line);
  return { id: newId("r"), tokens: tokens.length ? tokens : [{ id: newId("t"), key: "not", value: "" }] };
}

function isValidTypeRemap(value: string): boolean {
  if (!value.includes(">")) return false;
  const [main] = value.split(":");
  const [from, to] = main.split(">");
  return Boolean(from?.trim() && to?.trim());
}

export function suggestionsForKey(key: RuleKey, ctx: ExpertSuggestions): string[] {
  const maxShift = ctx.maxShift ?? 11;
  switch (key) {
    case "day":
      return Array.from({ length: Math.max(1, ctx.planDays) }, (_, i) => String(i));
    case "slot":
      return ctx.slotIds;
    case "shift":
      return Array.from({ length: maxShift + 1 }, (_, i) => String(i));
    case "force":
    case "not":
    case "exclude":
      return ctx.soldierIds;
    case "pin":
      return ctx.platoonCodes;
    case "force_type":
      return ctx.typeCodes.length ? ctx.typeCodes : ["H", "E", "G"];
    case "type_remap":
      return ["G>H:1", "G>H:2", "E>H:1"];
    default:
      return [];
  }
}

export function defaultValueForKey(key: RuleKey, ctx: ExpertSuggestions): string {
  const s = suggestionsForKey(key, ctx);
  return s[0] ?? "";
}

export function validateRuleRow(row: RuleRow, ctx: ExpertSuggestions): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const keyCounts = new Map<string, number>();
  let opCount = 0;
  let hasExclude = false;

  for (const token of row.tokens) {
    keyCounts.set(token.key, (keyCounts.get(token.key) ?? 0) + 1);

    if (!isRuleKey(token.key)) {
      issues.push({
        tokenId: token.id,
        severity: "error",
        code: "unknown_key",
        message: `Unknown field "${token.key}"`,
      });
      continue;
    }

    if (!token.value.trim()) {
      issues.push({
        tokenId: token.id,
        severity: "error",
        code: "empty_value",
        message: `${token.key} requires a value`,
      });
    }

    if (token.key === "day" && token.value.trim() && !/^-?\d+$/.test(token.value.trim())) {
      issues.push({
        tokenId: token.id,
        severity: "error",
        code: "invalid_day",
        message: "day must be an integer",
      });
    }

    if (token.key === "shift" && token.value.trim() && !/^-?\d+$/.test(token.value.trim())) {
      issues.push({
        tokenId: token.id,
        severity: "error",
        code: "invalid_shift",
        message: "shift must be an integer",
      });
    }

    if (token.key === "type_remap" && token.value.trim() && !isValidTypeRemap(token.value.trim())) {
      issues.push({
        tokenId: token.id,
        severity: "error",
        code: "invalid_type_remap",
        message: "type_remap format: G>H:2",
      });
    }

    if (isOperationKey(token.key)) {
      opCount += 1;
      if (opCount > 1) {
        issues.push({
          tokenId: token.id,
          severity: "warn",
          code: "multiple_ops",
          message: "Only one operation per line is recommended",
        });
      }
    }

    if (token.key === "exclude") hasExclude = true;

    if (
      (token.key === "force" || token.key === "not" || token.key === "exclude") &&
      token.value.trim() &&
      ctx.soldierIds.length > 0
    ) {
      const ids = token.value.split(",").map((s) => s.trim()).filter(Boolean);
      for (const id of ids) {
        if (!ctx.soldierIds.includes(id)) {
          issues.push({
            tokenId: token.id,
            severity: "warn",
            code: "unknown_soldier",
            message: `"${id}" not in roster`,
          });
        }
      }
    }
  }

  for (const [key, count] of keyCounts) {
    if (count > 1) {
      const token = row.tokens.find((t) => t.key === key);
      issues.push({
        tokenId: token?.id,
        severity: "warn",
        code: "duplicate_key",
        message: `Duplicate "${key}" on this line`,
      });
    }
  }

  if (hasExclude) {
    const slotTok = row.tokens.find((t) => t.key === "slot");
    const shiftTok = row.tokens.find((t) => t.key === "shift");
    if (slotTok) {
      issues.push({
        tokenId: slotTok.id,
        severity: "error",
        code: "exclude_slot",
        message: "exclude cannot use slot; use not instead",
      });
    }
    if (shiftTok) {
      issues.push({
        tokenId: shiftTok.id,
        severity: "error",
        code: "exclude_shift",
        message: "exclude cannot use shift; use not instead",
      });
    }
  }

  if (opCount === 0 && row.tokens.length > 0) {
    issues.push({
      severity: "warn",
      code: "missing_op",
      message: "Add an operation (not, force, exclude, …)",
    });
  }

  return issues;
}

/** Match server parse error to a line index when message contains quoted rule line. */
export function rowIndexFromParseError(message: string, rows: RuleRow[]): number | null {
  const m = /parse rule "([^"]+)"/i.exec(message);
  if (!m) return null;
  const badLine = m[1];
  const idx = rows.findIndex((r) => serializeRuleRow(r) === badLine);
  return idx >= 0 ? idx : null;
}

export function lineIndexFromParseError(message: string, lines: string[]): number | null {
  const m = /parse rule "([^"]+)"/i.exec(message);
  if (!m) return null;
  const bad = m[1].trim();
  const idx = lines.findIndex((l) => l.trim() === bad);
  return idx >= 0 ? idx : null;
}

export function splitEditorLines(text: string): string[] {
  if (!text) return [""];
  return text.split("\n");
}

export function joinEditorLines(lines: string[]): string {
  return lines.join("\n");
}

export type HighlightKind = "context" | "operation" | "exclude" | "sep" | "value" | "plain" | "comment";

function keyHighlightKind(key: string): HighlightKind {
  if (key === "exclude") return "exclude";
  if (key === "type_remap" || isOperationKey(key)) return "operation";
  if (CONTEXT_KEYS.includes(key as RuleKey)) return "context";
  return "plain";
}

/** Colored syntax segments for one rule line. */
export function highlightLineParts(line: string): { text: string; kind: HighlightKind }[] {
  if (/^\s*#/.test(line)) {
    return [{ text: line, kind: "comment" }];
  }
  if (!line) return [{ text: "", kind: "plain" }];

  const out: { text: string; kind: HighlightKind }[] = [];
  const chunks = line.match(/\S+|\s+/g) ?? [line];
  for (const chunk of chunks) {
    if (/^\s+$/.test(chunk)) {
      out.push({ text: chunk, kind: "plain" });
      continue;
    }
    if (chunk === "type_remap") {
      out.push({ text: chunk, kind: "operation" });
      continue;
    }
    const colon = chunk.indexOf(":");
    if (colon > 0) {
      const key = chunk.slice(0, colon);
      const val = chunk.slice(colon + 1);
      out.push({ text: key, kind: keyHighlightKind(key) });
      out.push({ text: ":", kind: "sep" });
      out.push({ text: val, kind: "value" });
    } else {
      out.push({ text: chunk, kind: chunk.includes(">") ? "value" : "plain" });
    }
  }
  return out;
}

export function autocompleteSuggestions(
  line: string,
  caret: number,
  ctx: ExpertSuggestions
): string[] {
  const before = line.slice(0, caret);
  const valueMatch = /(?:^|\s)(\w+):([^\s]*)$/.exec(before);
  if (valueMatch && isRuleKey(valueMatch[1])) {
    const partial = valueMatch[2].toLowerCase();
    const all = suggestionsForKey(valueMatch[1], ctx);
    if (!partial) return all.slice(0, 12);
    return all.filter((s) => s.toLowerCase().startsWith(partial)).slice(0, 12);
  }
  if (before.endsWith(":")) return [];
  const keyMatch = /(?:^|\s)(\w*)$/.exec(before);
  if (keyMatch) {
    const partial = keyMatch[1].toLowerCase();
    const keys = [...RULE_KEYS];
    const filtered = partial ? keys.filter((k) => k.startsWith(partial)) : keys;
    return filtered.map((k) => `${k}:`).slice(0, 12);
  }
  return [];
}

export function applyAutocompleteSuggestion(
  line: string,
  caret: number,
  pick: string
): { line: string; caret: number } {
  const before = line.slice(0, caret);
  const after = line.slice(caret);
  const valueMatch = /(?:^|\s)(\w+):([^\s]*)$/.exec(before);
  if (valueMatch && isRuleKey(valueMatch[1])) {
    const prefix = before.slice(0, before.length - valueMatch[2].length);
    const newLine = prefix + pick + after;
    return { line: newLine, caret: prefix.length + pick.length };
  }
  const keyMatch = /(?:^|\s)(\w*)$/.exec(before);
  if (keyMatch) {
    const prefix = before.slice(0, before.length - keyMatch[1].length);
    const insert = pick.endsWith(":") ? pick : `${pick}:`;
    const newLine = prefix + insert + after;
    return { line: newLine, caret: prefix.length + insert.length };
  }
  return { line, caret };
}

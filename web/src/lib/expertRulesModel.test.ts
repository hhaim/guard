import { describe, expect, it } from "vitest";
import { EXPERT_RULES_EXAMPLE_LINES } from "./expertRulesExamples";
import {
  applyAutocompleteSuggestion,
  autocompleteSuggestions,
  highlightLineParts,
  lineIndexFromParseError,
  parseRuleLine,
  parseRulesText,
  rowFromExampleLine,
  serializeRuleRow,
  serializeRulesText,
  validateRuleRow,
} from "./expertRulesModel";

const ctx = {
  soldierIds: ["s1", "s2", "s3", "s34", "s42"],
  slotIds: ["1", "8", "hadas9"],
  typeCodes: ["H", "E", "G"],
  platoonCodes: ["2", "3"],
  planDays: 4,
  maxShift: 10,
};

describe("expertRulesModel parse/serialize", () => {
  for (const line of EXPERT_RULES_EXAMPLE_LINES) {
    it(`round-trips ${line}`, () => {
      const row = rowFromExampleLine(line);
      expect(serializeRuleRow(row)).toBe(line);
    });
  }

  it("parses wildcard exclude lines", () => {
    const rows = parseRulesText("exclude:s34\nday:0 exclude:s3\nnot:s3,s1 shift:0");
    expect(rows).toHaveLength(3);
    expect(serializeRulesText(rows)).toBe(
      "exclude:s34\nday:0 exclude:s3\nnot:s3,s1 shift:0"
    );
  });

  it("handles type_remap bare word format", () => {
    const tokens = parseRuleLine("day:0 slot:8 type_remap G>H:2");
    expect(tokens.find((t) => t.key === "type_remap")?.value).toBe("G>H:2");
  });
});

describe("validateRuleRow", () => {
  it("flags exclude with shift", () => {
    const row = rowFromExampleLine("exclude:s1 shift:0");
    const issues = validateRuleRow(row, ctx);
    expect(issues.some((i) => i.code === "exclude_shift" && i.severity === "error")).toBe(true);
  });

  it("warns on unknown soldier", () => {
    const row = rowFromExampleLine("not:unknown");
    const issues = validateRuleRow(row, ctx);
    expect(issues.some((i) => i.code === "unknown_soldier")).toBe(true);
  });

  it("errors on invalid type_remap", () => {
    const row = rowFromExampleLine("day:0 slot:8 type_remap G-H:2");
    const issues = validateRuleRow(row, ctx);
    expect(issues.some((i) => i.code === "invalid_type_remap")).toBe(true);
  });
});

describe("highlightLineParts", () => {
  it("colors keys and separator", () => {
    const parts = highlightLineParts("day:0 not:s1");
    expect(parts.some((p) => p.kind === "context" && p.text === "day")).toBe(true);
    expect(parts.some((p) => p.kind === "sep")).toBe(true);
    expect(parts.some((p) => p.kind === "operation" && p.text === "not")).toBe(true);
  });
});

describe("autocompleteSuggestions", () => {
  it("suggests keys while typing", () => {
    const s = autocompleteSuggestions("d", 1, ctx);
    expect(s).toContain("day:");
  });

  it("suggests soldiers after not:", () => {
    const s = autocompleteSuggestions("not:s", 5, ctx);
    expect(s.some((x) => x.startsWith("s"))).toBe(true);
  });

  it("applies value suggestion", () => {
    const r = applyAutocompleteSuggestion("not:s", 5, "s1");
    expect(r.line).toBe("not:s1");
  });
});

describe("lineIndexFromParseError", () => {
  it("finds bad line", () => {
    const idx = lineIndexFromParseError('parse rule "exclude:s1 shift:0": exclude', [
      "exclude:s34",
      "exclude:s1 shift:0",
    ]);
    expect(idx).toBe(1);
  });
});

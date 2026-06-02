import { describe, expect, it } from "vitest";
import { ApiError, formatApiError, isStructuredApiError, parseApiError } from "./apiError";

describe("parseApiError", () => {
  it("handles plain string errors", () => {
    const p = parseApiError(new Error("network down"));
    expect(p.headline).toBe("network down");
    expect(p.code).toBeUndefined();
  });

  it("handles legacy error-only JSON", () => {
    const p = parseApiError(new Error(JSON.stringify({ error: "bad anchor" })));
    expect(p.headline).toBe("bad anchor");
    expect(p.message).toBe("bad anchor");
  });

  it("handles full structured body", () => {
    const body = {
      error: "Could not build a valid schedule",
      code: "rest_constraint",
      status: 422,
      message: "guardsched: rest constraint: day 1",
      request: { anchor_date: "2026-06-03", days: 1 },
      processing: { sim_mode: "extend_witness", soldier_count: 80 },
      hints: ["Check absences"],
      details: { day: 1, slot: 2 },
    };
    const p = parseApiError(new ApiError(422, body));
    expect(p.code).toBe("rest_constraint");
    expect(p.status).toBe(422);
    expect(p.headline).toBe("Could not assign all duties");
    expect(p.processing?.sim_mode).toBe("extend_witness");
    expect(p.hints).toEqual(["Check absences"]);
    expect(p.details?.day).toBe(1);
  });

  it("handles schedule_conflict with dates", () => {
    const body = {
      error: "schedule_conflict",
      code: "schedule_conflict",
      conflicting_dates: ["2026-06-03", "2026-06-04"],
    };
    const p = parseApiError(new ApiError(409, body));
    expect(p.code).toBe("schedule_conflict");
    expect(p.conflicting_dates).toEqual(["2026-06-03", "2026-06-04"]);
    expect(p.headline).toContain("Verified schedule");
  });
});

describe("isStructuredApiError", () => {
  it("detects structured envelope", () => {
    const p = parseApiError(
      new ApiError(422, {
        error: "x",
        code: "rest_constraint",
        processing: { soldier_count: 10 },
        message: "detail",
      })
    );
    expect(isStructuredApiError(p)).toBe(true);
  });

  it("false for plain message", () => {
    expect(isStructuredApiError(parseApiError(new Error("network")))).toBe(false);
  });
});

describe("formatApiError", () => {
  it("returns mapped headline for known codes", () => {
    expect(
      formatApiError(
        new ApiError(422, { error: "x", code: "rest_constraint", message: "x" })
      )
    ).toBe("Could not assign all duties");
  });
});

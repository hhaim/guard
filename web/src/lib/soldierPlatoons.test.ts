import { describe, expect, it } from "vitest";
import { collectUsedPlatoonCodes, validateDoc } from "./soldierPlatoons";

describe("soldierPlatoons", () => {
  it("validateDoc rejects duplicate codes", () => {
    const err = validateDoc({
      platoons: [
        { code: "1", label: "A" },
        { code: "1", label: "B" },
      ],
    });
    expect(err).toMatch(/Duplicate/);
  });

  it("collectUsedPlatoonCodes tracks assigned platoons", () => {
    const used = collectUsedPlatoonCodes([
      { id: "s0", full_name: "A", platoon_code: "1" },
      { id: "s1", full_name: "B" },
    ]);
    expect(used.has("1")).toBe(true);
    expect(used.has("2")).toBe(false);
  });
});

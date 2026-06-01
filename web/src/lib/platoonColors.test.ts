import { describe, expect, it } from "vitest";
import { parsePlatoonColorsFromGlobal, platoonBadgeStyle } from "./platoonColors";

describe("platoonColors", () => {
  it("parsePlatoonColorsFromGlobal reads platoon_colors array", () => {
    const colors = parsePlatoonColorsFromGlobal({
      platoon_colors: [{ code: "1", bg: "#dbeafe", fg: "#1e3a8a" }],
    });
    expect(colors).toEqual([{ code: "1", bg: "#dbeafe", fg: "#1e3a8a" }]);
  });

  it("platoonBadgeStyle falls back to index palette when code missing", () => {
    const style = platoonBadgeStyle("9", [], 2);
    expect(style.backgroundColor).toMatch(/^#/);
    expect(style.color).toMatch(/^#/);
  });

  it("platoonBadgeStyle uses configured entry", () => {
    const style = platoonBadgeStyle("1", [{ code: "1", bg: "#ff0000" }], 0);
    expect(style).toEqual({ backgroundColor: "#ff0000", color: expect.any(String) });
  });
});

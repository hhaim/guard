import { describe, expect, it } from "vitest";
import {
  parsePlatoonColorsFromGlobal,
  platoonAvatarStyle,
  platoonBadgeStyle,
  platoonFallbackIndex,
} from "./platoonColors";

describe("platoonColors", () => {
  it("parsePlatoonColorsFromGlobal reads platoon_colors array", () => {
    const colors = parsePlatoonColorsFromGlobal({
      platoon_colors: [{ code: "1", bg: "#dbeafe", fg: "#1e3a8a" }],
    });
    expect(colors).toEqual([{ code: "1", bg: "#dbeafe", fg: "#1e3a8a" }]);
  });

  it("platoonBadgeStyle uses stable fallback per platoon code when not configured", () => {
    const a = platoonBadgeStyle("1", []);
    const b = platoonBadgeStyle("1", []);
    expect(a).toEqual(b);
    expect(platoonFallbackIndex("1")).toBe(platoonFallbackIndex("1"));
  });

  it("platoonBadgeStyle uses configured entry", () => {
    const style = platoonBadgeStyle("1", [{ code: "1", bg: "#ff0000" }], 0);
    expect(style).toEqual({ backgroundColor: "#ff0000", color: expect.any(String) });
  });

  it("platoonAvatarStyle clears gradient layer for avatars", () => {
    const style = platoonAvatarStyle("1", [{ code: "1", bg: "#fdd3e4" }]);
    expect(style).toEqual({
      background: "#fdd3e4",
      backgroundImage: "none",
      color: expect.any(String),
    });
  });
});

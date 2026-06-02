import { describe, expect, it } from "vitest";
import { buildSoldierDisplay } from "./soldierDisplay";

describe("buildSoldierDisplay", () => {
  const soldiers = [
    { id: "s0", full_name: "A", platoon_code: "1" },
    { id: "s1", full_name: "B", platoon_code: "1" },
    { id: "s2", full_name: "C", platoon_code: "2" },
  ];

  it("uses same platoon color for soldiers in the same platoon", () => {
    const display = buildSoldierDisplay(
      ["s0", "s1", "s2"],
      soldiers,
      3,
      [{ code: "1", bg: "#ff0000" }, { code: "2", bg: "#00ff00" }]
    );
    expect(display.badgeStyle(0)).toEqual(display.badgeStyle(1));
    expect(display.badgeStyle(0).backgroundColor).toBe("#ff0000");
    expect(display.badgeStyle(2).backgroundColor).toBe("#00ff00");
  });

  it("matrix cell uses platoon bg; badge is transparent on cell", () => {
    const display = buildSoldierDisplay(
      ["s0"],
      soldiers,
      1,
      [{ code: "1", bg: "#aabbcc" }]
    );
    expect(display.matrixCellStyle(0)).toEqual({ backgroundColor: "#aabbcc" });
    expect(display.matrixBadgeStyle(0)).toEqual({
      backgroundColor: "transparent",
      color: display.badgeStyle(0).color,
    });
  });
});

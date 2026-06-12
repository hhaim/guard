import { describe, expect, it } from "vitest";
import type { ScheduleAssignment } from "./planDoc";
import {
  buildMatrixCellTooltip,
  buildSoldierProfileTooltip,
  formatSoldierTooltipLines,
} from "./soldierTooltip";

describe("soldierTooltip", () => {
  it("formats short tooltip lines with slot id in w vector", () => {
    const lines = formatSoldierTooltipLines({
      name: "John",
      id: "s43",
      typeCode: "A",
      typeName: "Alpha",
      totalHours: 7.9,
      slotHours: [0, 0, 0, 0, 0, 0, 0, 7.9],
    });
    expect(lines).toContain("n:John");
    expect(lines).toContain("id:s43");
    expect(lines).toContain("ty:A");
    expect(lines).toContain("tyn:Alpha");
    expect(lines).toContain("t:7.9h");
    expect(lines).toContain("w:[8:7.9]");
  });

  it("builds profile tooltip from raw hours by slot", () => {
    const slotHours = [0, 0, 0];
    slotHours[0] = 4;
    const lines = buildSoldierProfileTooltip(
      0,
      slotHours,
      ["s0"],
      [{ id: "s0", full_name: "Alice", type_code: "H" }],
      { types: [{ code: "H", label: "Heavy" }] },
    );
    expect(lines.join("\n")).toMatch(/t:4h/);
    expect(lines.join("\n")).toMatch(/w:\[1:4\.0\]/);
  });

  it("builds matrix cell tooltip for shift assignments by slot id", () => {
    const asn: ScheduleAssignment[] = [
      {
        day: 0,
        calendar_block: 2,
        start_hour: 13,
        slot: 1,
        soldier_idx: 3,
        loc_i: 1,
        time_j: 2,
        weight: 5,
        raw_hours: 4,
      },
    ];
    const lines = buildMatrixCellTooltip(
      3,
      asn,
      5,
      ["s3"],
      [{ id: "s3", full_name: "Bob", type_code: "G" }],
    );
    expect(lines.join("\n")).toMatch(/t:4h/);
    expect(lines.join("\n")).toMatch(/w:\[2:4\.0\]/);
  });

  it("prepends day slot shift coords for matrix cells", () => {
    const lines = buildMatrixCellTooltip(
      0,
      [],
      4,
      ["s0"],
      [{ id: "s0", full_name: "A" }],
      undefined,
      { day: 0, slot: 2, shift: 2 },
    );
    expect(lines[0]).toBe("day:0 slot:2 shift:2");
  });
});

import { describe, expect, it } from "vitest";
import { buildSoldierDisplay } from "./soldierDisplay";
import type { MatrixCell } from "./scheduleReport";

/** Mirrors ScheduleResultsReport MatrixCellContent label pick. */
function resolveMatrixLabels(
  cell: MatrixCell,
  indices: number[],
  useFullNames: boolean | undefined,
  display: ReturnType<typeof buildSoldierDisplay>,
  labelForIdx: (idx: number) => string
): string[] {
  return useFullNames
    ? indices.map((idx) => display.fullLabel(idx))
    : (cell.labels ?? indices.map((idx) => labelForIdx(idx)));
}

describe("matrix full-name labels", () => {
  const soldiers = [
    { id: "s0", full_name: "Alice Alpha" },
    { id: "s1", full_name: "Bob Beta" },
  ];
  const soldierIds = ["s0", "s1"];
  const display = buildSoldierDisplay(soldierIds, soldiers, 2);

  it("shows full names when useFullNames even if cell.labels has ids", () => {
    const cell: MatrixCell = {
      soldierIdx: 0,
      label: "",
      soldierIndices: [0],
      labels: ["s0"],
    };
    const labels = resolveMatrixLabels(cell, [0], true, display, display.fullLabel);
    expect(labels[0]).toBe("Alice Alpha");
  });

  it("uses soldier ids in short matrix when cell.labels is set", () => {
    const cell: MatrixCell = {
      soldierIdx: 0,
      label: "",
      soldierIndices: [0],
      labels: ["s0"],
    };
    const labels = resolveMatrixLabels(
      cell,
      [0],
      false,
      display,
      display.shortLabel
    );
    expect(labels[0]).toBe("s0");
  });

  it("fullLabel resolves names when cell.labels is absent", () => {
    const cell: MatrixCell = {
      soldierIdx: 0,
      label: "",
      soldierIndices: [0],
    };
    const labels = resolveMatrixLabels(cell, [0], false, display, display.fullLabel);
    expect(labels[0]).toBe("Alice Alpha");
  });
});

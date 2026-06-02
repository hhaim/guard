import { describe, expect, it } from "vitest";
import { PLAN_DOC_FORMAT_VERSION, type PlanDoc } from "./planDoc";
import { buildPlanMatrixXlsHtml } from "./planMatrixExport";
import type { ZonesDoc } from "./zones";

const stubZones = (): ZonesDoc => ({
  schema_version: 1,
  shift_hours: 4,
  slots_types: [{ id: "t1", name: "Rotating", pattern: "rotating" }],
  zone_loc: [{ id: "l0", type: "t1", name: "Gate", full_name: "Main gate", weight: 1 }],
  slots: [{ location_id: "l0", name: "S1", full_name: "Post 1" }],
  time_zones: [{ id: "tz0", name: "Day", weight: 1, from_hour: "00:00", to_hour: "24:00" }],
});

describe("buildPlanMatrixXlsHtml", () => {
  it("exports matrix tables with full names and platoon cell background", () => {
    const plan: PlanDoc = {
      format_version: PLAN_DOC_FORMAT_VERSION,
      anchor_date: "2024-06-01",
      days: 1,
      shift_hours: 4,
      assignments: [
        {
          day: 0,
          calendar_block: 0,
          start_hour: 5,
          slot: 0,
          soldier_idx: 0,
          loc_i: 0,
          time_j: 0,
          weight: 1,
          raw_hours: 4,
        },
      ],
    };
    const html = buildPlanMatrixXlsHtml({
      plan,
      zones: stubZones(),
      soldierIds: ["s0"],
      soldiers: [{ id: "s0", full_name: "Alice Alpha", platoon_code: "1" }],
      platoonColors: [{ code: "1", bg: "#ff0000" }],
    });
    expect(html).toContain("Alice Alpha");
    expect(html).toContain('background-color:#ff0000');
    expect(html).toContain("<table");
    expect(html).not.toContain("fairness");
    expect(html).not.toContain("Schedule stats");
    expect(html).not.toMatch(/<h[12]/i);
  });
});

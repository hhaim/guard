/**
 * CLI check: plan/history soldier table (buildSoldierBlockRows) shows span weights.
 * Usage: npx tsx scripts/verify-plan-soldier-weight.ts <zones.yaml> <assignments.json>
 */
import { readFileSync } from "fs";
import { parseZonesYaml } from "../src/lib/zones.ts";
import { buildZoneReportView, buildSoldierBlockRows } from "../src/lib/scheduleReport.ts";
import { normalizeAssignment } from "../src/lib/planDoc.ts";

const zonesPath = process.argv[2];
const assignPath = process.argv[3];
if (!zonesPath || !assignPath) {
  console.error("usage: verify-plan-soldier-weight.ts <zones.yaml> <assignments.json>");
  process.exit(2);
}

const zones = parseZonesYaml(readFileSync(zonesPath, "utf8"));
const go = JSON.parse(readFileSync(assignPath, "utf8")) as {
  assignments: Record<string, unknown>[];
};
const assignments = go.assignments.map((a) => normalizeAssignment(a));
const zone = buildZoneReportView(zones, zones.slots.length);
if (zones.shift_hours > 0) {
  zone.shiftHours = zones.shift_hours;
  zone.blocksPerDay = Math.round(24 / zone.shiftHours);
}

const soldierIdx = 1;
const rows = buildSoldierBlockRows(soldierIdx, assignments, 2, zone, 5);
const morning = rows.find((r) => r.day === 1 && r.block === 2);
const day = rows.find((r) => r.day === 1 && r.block === 3);

if (!morning?.rest || morning.weight === "—" || !day?.rest || day.weight === "—") {
  console.error(JSON.stringify({ morning, day, typeWeightMult: zone.typeWeightMult }));
  process.exit(1);
}

console.log(
  JSON.stringify({
    soldier_idx: soldierIdx,
    kitchen_team_wm: zone.typeWeightMult["kitchen_team_1"],
    morning_block_weight: Number(morning.weight),
    day_block_weight: Number(day.weight),
    morning_row: morning,
    day_row: day,
  })
);

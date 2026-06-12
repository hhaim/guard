import { describe, expect, it } from "vitest";
import {
  buildPlatoonStatusImportPayloads,
  buildPlatoonVacationImportPayload,
  detectPlatoonAwayGroups,
  formatPlatoonStatusReport,
  matchesFromState,
  planPlatoonStatusChange,
  soldierIdsInPlatoonAwayGroups,
} from "./platoonVacation";
import type { SoldierStatusEntry } from "../api/soldierStatus";
import type { PlanDaySoldiersDoc } from "./planDoc";
import type { Soldier } from "./soldiers";

const roster: Soldier[] = [
  { id: "a1", full_name: "A1", platoon_code: "1" },
  { id: "a2", full_name: "A2", platoon_code: "1" },
  { id: "b1", full_name: "B1", platoon_code: "2" },
];

function day(full: string[], absent: string[]): PlanDaySoldiersDoc {
  return { avail_full: full, avail_absent: absent };
}

function awayEntry(soldierId: string, planDay: string, hour = 5): SoldierStatusEntry {
  const start = new Date(`${planDay}T00:00:00.000Z`);
  start.setUTCHours(hour, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return {
    soldier_id: soldierId,
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    status: "away",
    editable: true,
  };
}

describe("planPlatoonStatusChange", () => {
  it("updates soldier for full range when from state on every day", () => {
    const days = ["2026-06-02", "2026-06-03"];
    const previews: Record<string, PlanDaySoldiersDoc> = {
      "2026-06-02": day(["a1", "b1"], ["a2"]),
      "2026-06-03": day(["a1", "b1"], ["a2"]),
    };
    const entries = [awayEntry("a2", "2026-06-02"), awayEntry("a2", "2026-06-03")];
    const plan = planPlatoonStatusChange(
      roster,
      "1",
      days,
      previews,
      entries,
      "away",
      "on_base",
      5,
    );
    expect(new Set(plan.updates.map((u) => u.soldier.id))).toEqual(new Set(["a2"]));
    expect(plan.updates).toHaveLength(2);
    expect(plan.unchanged).toHaveLength(1);
    expect(plan.unchanged[0].soldier.id).toBe("a1");
  });

  it("does not change soldier when not in from state on every day", () => {
    const days = ["2026-06-02", "2026-06-03"];
    const previews: Record<string, PlanDaySoldiersDoc> = {
      "2026-06-02": day(["a1"], ["a2"]),
      "2026-06-03": day(["a1", "a2"], []),
    };
    const entries = [awayEntry("a2", "2026-06-02")];
    const plan = planPlatoonStatusChange(
      roster,
      "1",
      days,
      previews,
      entries,
      "away",
      "on_base",
      5,
    );
    expect(plan.updates).toHaveLength(0);
    const a2 = plan.unchanged.find((u) => u.soldier.id === "a2");
    expect(a2?.reason).toMatch(/every plan day/);
    expect(a2?.days[1]?.current).toBe("on_base");
  });

  it("does not change sick soldier when from is away", () => {
    const days = ["2026-06-02"];
    const previews: Record<string, PlanDaySoldiersDoc> = {
      "2026-06-02": day(["a1"], ["a2"]),
    };
    const start = new Date("2026-06-02T05:00:00.000Z");
    const end = new Date("2026-06-03T05:00:00.000Z");
    const entries: SoldierStatusEntry[] = [
      {
        soldier_id: "a2",
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        status: "sick",
        editable: true,
      },
    ];
    const plan = planPlatoonStatusChange(
      roster,
      "1",
      days,
      previews,
      entries,
      "away",
      "on_base",
      5,
    );
    expect(plan.updates).toHaveLength(0);
    expect(plan.unchanged.find((u) => u.soldier.id === "a2")?.days[0].current).toBe("sick");
  });

  it("marks on_base soldiers away for whole range when from is on_base every day", () => {
    const days = ["2026-06-02", "2026-06-03"];
    const previews: Record<string, PlanDaySoldiersDoc> = {
      "2026-06-02": day(["a1", "a2"], []),
      "2026-06-03": day(["a1", "a2"], []),
    };
    const plan = planPlatoonStatusChange(
      roster,
      "1",
      days,
      previews,
      [],
      "on_base",
      "away",
      5,
    );
    expect(plan.updates).toHaveLength(4);
    expect(new Set(plan.updates.map((u) => u.soldier.id))).toEqual(new Set(["a1", "a2"]));
  });
});

describe("buildPlatoonStatusImportPayloads", () => {
  it("creates separate payloads per plan day", () => {
    const payloads = buildPlatoonStatusImportPayloads(
      [
        { soldier: roster[0], planDay: "2026-06-02" },
        { soldier: roster[1], planDay: "2026-06-03" },
      ],
      5,
      "on_base",
    );
    expect(payloads).toHaveLength(2);
    expect(payloads[0].soldier_ids).toEqual(["a1"]);
    expect(payloads[1].soldier_ids).toEqual(["a2"]);
  });
});

describe("matchesFromState", () => {
  it("matches on_base only when full", () => {
    expect(matchesFromState("on_base", "on_base")).toBe(true);
    expect(matchesFromState("away", "on_base")).toBe(false);
    expect(matchesFromState("partial", "away")).toBe(false);
  });
});

describe("detectPlatoonAwayGroups", () => {
  it("groups platoon when all members absent on contiguous days", () => {
    const dates = ["2026-06-02", "2026-06-03"];
    const byDay: Record<string, PlanDaySoldiersDoc> = {
      "2026-06-02": day(["b1"], ["a1", "a2"]),
      "2026-06-03": day(["b1"], ["a1", "a2"]),
    };
    const groups = detectPlatoonAwayGroups(roster, dates, byDay);
    expect(groups).toHaveLength(1);
    expect(groups[0].soldiers).toHaveLength(2);
  });
});

describe("formatPlatoonStatusReport", () => {
  it("lists unchanged soldiers with day summary", () => {
    const text = formatPlatoonStatusReport({
      platoonCode: "1",
      from: "away",
      target: "on_base",
      fromDate: "2026-06-02",
      throughDate: "2026-06-02",
      updates: [],
      unchanged: [
        {
          soldier: roster[0],
          reason: "Not Away on every plan day in range",
          days: [
            {
              planDay: "2026-06-02",
              current: "sick",
              currentLabel: "Sick",
            },
          ],
        },
      ],
    });
    expect(text).toMatch(/Unchanged soldiers \(1\)/);
    expect(text).toMatch(/Sick/);
  });
});

describe("buildPlatoonVacationImportPayload", () => {
  it("still builds away payload", () => {
    const payload = buildPlatoonVacationImportPayload(
      [{ id: "a1", full_name: "A1" }],
      "2026-06-02",
      "2026-06-02",
      5,
    );
    expect(payload.entries[0].status).toBe("away");
  });
});

describe("soldierIdsInPlatoonAwayGroups", () => {
  it("collects ids from groups", () => {
    const groups = detectPlatoonAwayGroups(roster, ["2026-06-02"], {
      "2026-06-02": day([], ["a1", "a2"]),
    });
    expect(soldierIdsInPlatoonAwayGroups(groups).has("a1")).toBe(true);
  });
});

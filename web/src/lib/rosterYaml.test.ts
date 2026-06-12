import { describe, expect, it } from "vitest";
import { parseRosterYaml, stringifyRosterYaml } from "./rosterYaml";

describe("rosterYaml platoons", () => {
  const typesDoc = { types: [{ code: "A", label: "Type A" }] };
  const platoonsDoc = { platoons: [{ code: "1", label: "chod" }] };
  const soldiersDoc = {
    soldiers: [{ id: "s0", full_name: "Soldier 0", type_code: "A", platoon_code: "1" }],
  };

  it("round-trips soldier_platoons and platoon_code", () => {
    const yaml = stringifyRosterYaml(typesDoc, soldiersDoc, undefined, platoonsDoc);
    const parsed = parseRosterYaml(yaml);
    expect(parsed.platoonsDoc?.platoons).toEqual(platoonsDoc.platoons);
    expect(parsed.soldiersDoc?.soldiers[0].platoon_code).toBe("1");
  });

  it("coerces legacy platoon field on import", () => {
    const yaml = `
schema_version: 2
soldiers:
  - { id: s0, full_name: S0, platoon: 2 }
`;
    const parsed = parseRosterYaml(yaml);
    expect(parsed.soldiersDoc?.soldiers[0].platoon_code).toBe("2");
  });
});

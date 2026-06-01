import { Download, Upload } from "lucide-react";
import { pickTextFile, downloadText } from "../lib/fileIo";
import { parseRosterYaml, stringifyRosterYaml } from "../lib/rosterYaml";
import {
  defaultStatusExportRange,
  entriesToYaml,
  type SoldierStatusYamlDoc,
} from "../lib/rosterStatusYaml";
import { listSoldierStatus } from "../api/soldierStatus";
import { fetchPlanContext } from "../api/plan";
import { parsePlanDayStart } from "../lib/planDay";
import type { SoldierPlatoonsDoc } from "../lib/soldierPlatoons";
import type { SoldierTypesDoc } from "../lib/soldierTypes";
import type { SoldiersDoc } from "../lib/soldiers";

type SoldiersYamlToolbarProps = {
  disabled?: boolean;
  typesDoc: SoldierTypesDoc;
  platoonsDoc: SoldierPlatoonsDoc;
  soldiersDoc: SoldiersDoc;
  onImport: (payload: {
    typesDoc?: SoldierTypesDoc;
    platoonsDoc?: SoldierPlatoonsDoc;
    soldiersDoc?: SoldiersDoc;
    statusDoc?: SoldierStatusYamlDoc;
  }) => void | Promise<void>;
};

export function SoldiersYamlToolbar({
  disabled,
  typesDoc,
  platoonsDoc,
  soldiersDoc,
  onImport,
}: SoldiersYamlToolbarProps) {
  const importYaml = async () => {
    try {
      const text = await pickTextFile(".yaml,.yml,text/yaml,text/plain");
      if (
        !confirm(
          "Import roster YAML? This updates soldier types, platoons, and/or roster in the UI (save to persist cfg). " +
            "If the file includes soldier_status, absence/vacation timelines are applied immediately for that range."
        )
      ) {
        return;
      }
      const parsed = parseRosterYaml(text);
      await onImport(parsed);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Import failed");
    }
  };

  const exportYaml = async () => {
    try {
      let statusDoc: SoldierStatusYamlDoc | undefined;
      const planCtx = await fetchPlanContext();
      const anchor = planCtx.plan_anchor;
      if (anchor) {
        const startParsed = parsePlanDayStart(planCtx.plan_day_start ?? "05:00");
        const hour = startParsed.ok ? startParsed.hour : 5;
        const range = defaultStatusExportRange(anchor, hour);
        const entries = await listSoldierStatus(range.from, range.to);
        statusDoc = { range, entries: entriesToYaml(entries) };
      }
      downloadText(
        `roster-${new Date().toISOString().slice(0, 10)}.yaml`,
        stringifyRosterYaml(typesDoc, soldiersDoc, statusDoc, platoonsDoc),
        "text/yaml"
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : "Export failed");
    }
  };

  return (
    <div className="zones-io-row">
      <button type="button" className="btn btn-tinted" disabled={disabled} onClick={() => importYaml()}>
        <Upload size={16} strokeWidth={2} />
        <span className="zones-io-label">Import YAML</span>
      </button>
      <button type="button" className="btn btn-tinted" disabled={disabled} onClick={() => exportYaml()}>
        <Download size={16} strokeWidth={2} />
        <span className="zones-io-label">Export YAML</span>
      </button>
    </div>
  );
}

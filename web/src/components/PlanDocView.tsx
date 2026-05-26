import { useMemo } from "react";
import type { ZonesDoc } from "../lib/zones";
import type { PlanDoc } from "../lib/planDoc";
import { normalizePlanDoc } from "../lib/planDoc";
import type { Soldier } from "../lib/soldiers";
import { PlanChangeTable } from "./PlanChangeTable";
import { PlanTopMetrics } from "./PlanTopMetrics";
import { ScheduleResultsReport, type ScheduleReportSections } from "./ScheduleResultsReport";
import { inferSoldierCount } from "../lib/scheduleReport";

export type PlanDocViewProps = {
  plan: PlanDoc;
  zones: ZonesDoc;
  soldierIds: string[];
  soldiers?: Soldier[];
  sections?: ScheduleReportSections;
  /** When set, show the editable change table above the report. */
  onPlanChange?: (next: PlanDoc) => void;
  readOnly?: boolean;
};

/**
 * Single entry point to render a plan/schedule document (proposals and verified history).
 */
export function PlanDocView({
  plan,
  zones,
  soldierIds,
  soldiers = [],
  sections,
  onPlanChange,
  readOnly = false,
}: PlanDocViewProps) {
  const doc = useMemo(() => normalizePlanDoc(plan), [plan]);
  const rosterSize = Math.max(soldierIds.length, inferSoldierCount(doc.assignments));

  return (
    <>
      {doc.assignments.length > 0 && (
        <PlanTopMetrics plan={doc} soldierCount={rosterSize} />
      )}
      {onPlanChange && (
        <PlanChangeTable
          plan={doc}
          zones={zones}
          soldiers={soldierIds}
          onChange={onPlanChange}
          readOnly={readOnly}
        />
      )}
      {doc.assignments.length > 0 ? (
        <ScheduleResultsReport
          plan={doc}
          zones={zones}
          soldierIds={soldierIds}
          soldiers={soldiers}
          sections={sections}
        />
      ) : (
        <p className="contacts-empty">No assignments in plan.</p>
      )}
    </>
  );
}

import { useMemo } from "react";
import type { ZonesDoc } from "../lib/zones";
import type { PlanDaySoldiersDoc, PlanDoc } from "../lib/planDoc";
import { normalizePlanDoc } from "../lib/planDoc";
import type { PlatoonColorEntry } from "../lib/platoonColors";
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
  platoonColors?: PlatoonColorEntry[];
  sections?: ScheduleReportSections;
  /** When set, show the editable change table above the report. */
  onPlanChange?: (next: PlanDoc) => void;
  readOnly?: boolean;
  soldiersByDay?: Record<string, PlanDaySoldiersDoc>;
};

/**
 * Single entry point to render a plan/schedule document (proposals and verified history).
 * Soldier tables and timelines use {@link ScheduleResultsReport} (same rules as Go sim JSON).
 */
export function PlanDocView({
  plan,
  zones,
  soldierIds,
  soldiers = [],
  platoonColors = [],
  sections,
  onPlanChange,
  readOnly = false,
  soldiersByDay,
}: PlanDocViewProps) {
  const doc = useMemo(() => normalizePlanDoc(plan), [plan]);
  const rosterSize = Math.max(soldierIds.length, inferSoldierCount(doc.assignments));

  return (
    <>
      {doc.assignments.length > 0 && (
        <PlanTopMetrics
          plan={doc}
          soldierCount={rosterSize}
          soldierIds={soldierIds}
          soldiersByDay={soldiersByDay}
        />
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
          platoonColors={platoonColors}
          sections={sections}
        />
      ) : (
        <p className="contacts-empty">No assignments in plan.</p>
      )}
    </>
  );
}

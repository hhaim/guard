import { useMemo } from "react";
import type { PlanDoc } from "../lib/planDoc";
import type { Soldier } from "../lib/soldiers";
import { buildSoldierDisplay } from "../lib/soldierDisplay";
import {
  buildPlanAvailabilityReport,
  classificationLabel,
  formatAvailabilityWindows,
} from "../lib/planSoldierAvailability";

type Props = {
  plan: PlanDoc;
  soldiers: Soldier[];
};

export function PlanSoldierAvailabilitySection({ plan, soldiers }: Props) {
  const display = useMemo(
    () => buildSoldierDisplay(soldiers.map((s) => s.id), soldiers, soldiers.length),
    [soldiers],
  );

  const labelForId = useMemo(() => {
    const ids = soldiers.map((s) => s.id);
    return (id: string) => {
      const idx = ids.indexOf(id);
      return idx >= 0 ? display.fullLabel(idx) : id;
    };
  }, [soldiers, display]);

  const days = useMemo(
    () => buildPlanAvailabilityReport(plan, soldiers, labelForId),
    [plan, soldiers, labelForId],
  );

  if (!plan.soldiers || days.length === 0) {
    return (
      <section className="sched-section">
        <h3 className="sched-section-title">Soldier availability</h3>
        <p className="contacts-empty">No availability snapshot on this plan (regenerate to embed).</p>
      </section>
    );
  }

  return (
    <section className="sched-section sched-availability-report">
      <h3 className="sched-section-title">Soldier availability</h3>
      <p className="sched-hint">
        Snapshot from plan generate/apply. Full = assignable entire plan day; Partial = gaps; Absent = not
        assignable for the plan day.
      </p>
      {days.map((day) => (
        <div key={day.date} className="sched-availability-day">
          <div className="availability-badges" role="group" aria-label={`Availability ${day.date}`}>
            <span className="run-field-label title availability-badges-title">{day.date}</span>
            <div className="availability-badges-row">
              <span className="availability-badge availability-badge--full" title="Full plan day">
                {day.summary.full}
              </span>
              <span className="availability-badge availability-badge--absent" title="Absent full plan day">
                {day.summary.absent_full}
              </span>
              <span className="availability-badge availability-badge--partial" title="Partial">
                {day.summary.absent_partial}
              </span>
            </div>
          </div>
          <div className="sched-table-scroll">
            <table className="sched-table sched-availability-table">
              <thead>
                <tr>
                  <th>Soldier</th>
                  <th>Classification</th>
                  <th>Assignable windows</th>
                </tr>
              </thead>
              <tbody>
                {day.rows.map((row) => (
                  <tr
                    key={`${day.date}-${row.soldierId}`}
                    className={`sched-avail-row sched-avail-row--${row.classification}`}
                  >
                    <th scope="row">{row.label}</th>
                    <td>{classificationLabel(row.classification)}</td>
                    <td>{formatAvailabilityWindows(row.windows)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}

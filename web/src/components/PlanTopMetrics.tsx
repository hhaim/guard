import { useMemo } from "react";
import type { PlanDoc } from "../lib/planDoc";
import {
  computePlanWorkloadMetrics,
  inferSoldierCount,
  loadFactorLevel,
} from "../lib/scheduleReport";

type Props = {
  plan: PlanDoc;
  soldierCount: number;
};

function formatHours(h: number): string {
  if (h >= 100) return `${Math.round(h)} h`;
  return `${h.toFixed(1)} h`;
}

export function PlanTopMetrics({ plan, soldierCount }: Props) {
  const metrics = useMemo(() => {
    const n = Math.max(soldierCount, inferSoldierCount(plan.assignments));
    return computePlanWorkloadMetrics(plan.assignments, plan.days, n);
  }, [plan.assignments, plan.days, soldierCount]);

  const loadPct = metrics.loadFactor * 100;
  const loadBand = loadFactorLevel(metrics.loadFactor);

  return (
    <div className="plan-top-metrics glass-card" aria-label="Plan workload summary">
      <div className="plan-top-metric">
        <span className="plan-top-metric-label">Load factor</span>
        <span className={`plan-top-metric-value plan-top-metric-load--${loadBand}`}>
          {loadPct.toFixed(1)}%
        </span>
        <span className="plan-top-metric-detail">
          {formatHours(metrics.totalWorkHours)} duty / {formatHours(metrics.totalCapacityHours)} roster
          capacity
        </span>
        <span className="plan-top-metric-hint">
          Share of all soldier-hours on duty · ≤10% low · ≥33% very high
        </span>
      </div>
      <div className="plan-top-metric">
        <span className="plan-top-metric-label">Fairness (σ duty hours)</span>
        <span className="plan-top-metric-value">{metrics.fairnessStdDevHours.toFixed(2)} h</span>
        <span className="plan-top-metric-detail">Std dev of total duty hours per soldier</span>
        <span className="plan-top-metric-hint">Lower = more even workload across the roster</span>
      </div>
    </div>
  );
}

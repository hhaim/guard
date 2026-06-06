import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { compactVectorTotalHours } from "../lib/formatCompactHourVector";
import type { PlanOverviewStats, ScheduleStatsBundle, SoldierSummaryRow } from "../lib/scheduleReport";
import { loadFactorLevel } from "../lib/scheduleReport";
import type { SoldierDisplay } from "../lib/soldierDisplay";
import type { Soldier } from "../lib/soldiers";
import type { SoldierTypesDoc } from "../lib/soldierTypes";
import { ColumnSortButton, type SortDirection } from "./ColumnSortButton";
import { SoldierChartLabel } from "./SoldierChartLabel";
import {
  STACKED_BAR_EPS,
  stackedBarScaleMax,
  stackedBarSegmentPct,
} from "../lib/stackedBarScale";

const SERIES_COLORS = [
  "#1f77b4",
  "#ff7f0e",
  "#2ca02c",
  "#d62728",
  "#9467bd",
  "#8c564b",
  "#e377c2",
  "#7f7f7f",
  "#bcbd22",
  "#17becf",
];

const DUTY_HOURS_EPS = STACKED_BAR_EPS;

type SummarySortKey =
  | "soldier"
  | "type"
  | "totalRaw"
  | "globalScore"
  | "rawSlot"
  | "timeBand"
  | "minFree"
  | "meanFree"
  | "maxFree"
  | "slots";

type Props = {
  stats: ScheduleStatsBundle;
  days: number;
  shiftHours: number;
  slotsPerBlock: number;
  soldierIds?: string[];
  soldiers?: Soldier[];
  typesDoc?: SoldierTypesDoc;
  display: SoldierDisplay;
  nameById: Map<string, string>;
  statsPresentation?: "plan" | "history";
  planOverview?: PlanOverviewStats;
};

function formatHours(h: number): string {
  if (!Number.isFinite(h)) return "—";
  if (h >= 100) return `${Math.round(h)} h`;
  return `${h.toFixed(1)} h`;
}

function StatLineChart({
  title,
  yLabel,
  data,
  seriesKeys,
}: {
  title: string;
  yLabel: string;
  data: Record<string, string | number>[];
  seriesKeys: string[];
}) {
  return (
    <div className="sched-stat-chart">
      <h4 className="sched-subtitle">{title}</h4>
      <div className="sched-chart-box">
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.35} />
            <XAxis dataKey="soldier" tick={{ fontSize: 11 }} interval={0} angle={0} />
            <YAxis tick={{ fontSize: 11 }} label={{ value: yLabel, angle: -90, position: "insideLeft", style: { fontSize: 11 } }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {seriesKeys.map((key, i) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function PlanOverviewMetrics({ overview }: { overview: PlanOverviewStats }) {
  const loadPct = overview.loadFactor * 100;
  const loadBand = loadFactorLevel(overview.loadFactor);
  const avgHours = overview.avgHoursPerWorkingSoldier;

  return (
    <div className="sched-plan-overview glass-card" aria-label="Plan overview">
      <h4 className="sched-subtitle">Plan overview</h4>
      <div className="sched-plan-overview-grid">
        <div className="plan-top-metric">
          <span className="plan-top-metric-label">Load factor</span>
          <span className={`plan-top-metric-value plan-top-metric-load--${loadBand}`}>
            {loadPct.toFixed(1)}%
          </span>
          <span className="plan-top-metric-detail">
            {formatHours(overview.totalWorkHours)} duty / {formatHours(overview.totalCapacityHours)} capacity
          </span>
        </div>
        <div className="plan-top-metric">
          <span className="plan-top-metric-label">Fairness (σ duty hours)</span>
          <span className="plan-top-metric-value">{overview.fairnessStdDevHours.toFixed(2)} h</span>
        </div>
        <div className="plan-top-metric">
          <span className="plan-top-metric-label">Soldiers free</span>
          <span className="plan-top-metric-value">{overview.soldiersFree}</span>
        </div>
        <div className="plan-top-metric">
          <span className="plan-top-metric-label">Soldiers assigned</span>
          <span className="plan-top-metric-value">{overview.soldiersAssigned}</span>
        </div>
        <div className="plan-top-metric">
          <span className="plan-top-metric-label">Avg hours / working soldier</span>
          <span className="plan-top-metric-value">{formatHours(avgHours)}</span>
        </div>
        <div className="plan-top-metric">
          <span className="plan-top-metric-label">Active slots</span>
          <span className="plan-top-metric-value">{overview.activeSlots}</span>
        </div>
        <div className="plan-top-metric">
          <span className="plan-top-metric-label">Total soldiers available</span>
          <span className="plan-top-metric-value">{overview.totalSoldiersAvailable}</span>
          {overview.assignableSoldierCount != null && (
            <span className="plan-top-metric-detail">
              {overview.assignableSoldierCount} assignable (availability snapshot)
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function SoldierHoursStackedBars({
  rows,
  segments,
  segmentLabels,
  title,
  display,
  nameById,
  soldierIds,
  soldiers,
  typesDoc,
}: {
  rows: SoldierSummaryRow[];
  segments: (row: SoldierSummaryRow) => number[];
  segmentLabels: string[];
  title: string;
  display: SoldierDisplay;
  nameById: Map<string, string>;
  soldierIds: string[];
  soldiers: Soldier[];
  typesDoc?: SoldierTypesDoc;
}) {
  if (rows.length === 0) return null;

  const scaleMax = stackedBarScaleMax(
    rows.map((row) => segments(row).reduce((a, b) => a + b, 0)),
  );

  return (
    <div className="sched-soldier-hours-chart">
      <h4 className="sched-subtitle">{title}</h4>
      {segmentLabels.length > 0 && (
        <ul className="sched-soldier-hours-legend" aria-label="Segment legend">
          {segmentLabels.map((label, i) => (
            <li key={label}>
              <span
                className="sched-soldier-hours-legend-swatch"
                style={{ backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length] }}
                aria-hidden
              />
              <span>{label}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="sched-soldier-hours-scroll">
        {rows.map((row) => {
          const segs = segments(row);
          const total = segs.reduce((a, b) => a + b, 0);
          return (
            <div key={row.soldierIdx} className="sched-soldier-hours-row">
              <SoldierChartLabel
                soldierIdx={row.soldierIdx}
                display={display}
                nameById={nameById}
                soldierIds={soldierIds}
                soldiers={soldiers}
                typesDoc={typesDoc}
                rawHoursBySlot={row.rawHoursBySlot}
              />
              <div
                className="sched-soldier-hours-track"
                aria-label={`${display.shortLabel(row.soldierIdx)}: ${total.toFixed(1)} h`}
              >
                {segs.map((h, i) => {
                  if (h <= DUTY_HOURS_EPS) return null;
                  const pct = stackedBarSegmentPct(h, scaleMax);
                  const segLabel = segmentLabels[i] ?? `Segment ${i + 1}`;
                  return (
                    <span
                      key={i}
                      className="sched-soldier-hours-seg"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length],
                      }}
                      title={`${segLabel}: ${h.toFixed(1)} h`}
                    />
                  );
                })}
              </div>
              <span className="sched-soldier-hours-total">{total.toFixed(1)} h</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SortableTh({
  label,
  sortKey,
  activeKey,
  direction,
  onToggle,
}: {
  label: string;
  sortKey: SummarySortKey;
  activeKey: SummarySortKey;
  direction: SortDirection;
  onToggle: (key: SummarySortKey) => void;
}) {
  return (
    <th scope="col" className="sched-summary-th-sortable">
      <span className="sched-summary-th-label">{label}</span>
      <ColumnSortButton
        label={label}
        active={activeKey === sortKey}
        direction={direction}
        onToggle={() => onToggle(sortKey)}
      />
    </th>
  );
}

function compareSummaryRows(
  a: SoldierSummaryRow,
  b: SoldierSummaryRow,
  key: SummarySortKey,
  dir: SortDirection,
): number {
  let cmp = 0;
  switch (key) {
    case "soldier":
      cmp = a.label.localeCompare(b.label, undefined, { numeric: true });
      break;
    case "type":
      cmp = a.typeCode.localeCompare(b.typeCode) || a.label.localeCompare(b.label);
      break;
    case "totalRaw":
      cmp = a.totalRawHours - b.totalRawHours;
      break;
    case "globalScore":
      cmp = a.globalScore - b.globalScore;
      break;
    case "rawSlot":
      cmp =
        compactVectorTotalHours(a.rawHoursBySlot) - compactVectorTotalHours(b.rawHoursBySlot);
      break;
    case "timeBand":
      cmp =
        compactVectorTotalHours(a.rawHoursByTime) - compactVectorTotalHours(b.rawHoursByTime);
      break;
    case "minFree":
      cmp = a.minMaxFree - b.minMaxFree;
      break;
    case "meanFree":
      cmp = a.meanMaxFree - b.meanMaxFree;
      break;
    case "maxFree":
      cmp = a.maxMaxFree - b.maxMaxFree;
      break;
    case "slots":
      cmp = a.slotIds.length - b.slotIds.length || (a.slotIds[0] ?? 0) - (b.slotIds[0] ?? 0);
      break;
    default:
      cmp = 0;
  }
  return dir === "asc" ? cmp : -cmp;
}

function FreeSoldiersFooter({
  freeSoldiers,
  display,
  nameById,
  soldierIds,
  soldiers,
  typesDoc,
}: {
  freeSoldiers: SoldierSummaryRow[];
  display: SoldierDisplay;
  nameById: Map<string, string>;
  soldierIds: string[];
  soldiers: Soldier[];
  typesDoc?: SoldierTypesDoc;
}) {
  if (freeSoldiers.length === 0) return null;
  return (
    <div className="sched-free-soldiers-footer">
      <strong>
        {freeSoldiers.length} soldier{freeSoldiers.length === 1 ? "" : "s"} free (0 guard hours):
      </strong>{" "}
      {freeSoldiers.map((row, i) => (
        <span key={row.soldierIdx} className="sched-free-soldier-entry-wrap">
          {i > 0 ? ", " : ""}
          <SoldierChartLabel
            soldierIdx={row.soldierIdx}
            display={display}
            nameById={nameById}
            soldierIds={soldierIds}
            soldiers={soldiers}
            typesDoc={typesDoc}
            rawHoursBySlot={row.rawHoursBySlot}
          />
        </span>
      ))}
    </div>
  );
}

export function ScheduleStatsPanel({
  stats,
  days,
  shiftHours,
  slotsPerBlock,
  soldierIds = [],
  soldiers = [],
  typesDoc,
  display,
  nameById,
  statsPresentation = "plan",
  planOverview,
}: Props) {
  const [sortKey, setSortKey] = useState<SummarySortKey>("totalRaw");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");

  const runTitle = useMemo(
    () => `${days}d — ${stats.soldierCount} soldiers, ${slotsPerBlock} slots/block, shift_hours=${shiftHours}h`,
    [days, stats.soldierCount, slotsPerBlock, shiftHours],
  );

  const { onDutySummary, freeSoldiers, onDutyByHoursDesc } = useMemo(() => {
    const free: SoldierSummaryRow[] = [];
    const onDuty: SoldierSummaryRow[] = [];
    for (const row of stats.summary) {
      if (row.totalRawHours <= DUTY_HOURS_EPS) free.push(row);
      else onDuty.push(row);
    }
    const byHours = [...onDuty].sort((a, b) => b.totalRawHours - a.totalRawHours);
    return { onDutySummary: onDuty, freeSoldiers: free, onDutyByHoursDesc: byHours };
  }, [stats.summary]);

  const sortedSummary = useMemo(() => {
    const rows = [...onDutySummary];
    rows.sort((a, b) => compareSummaryRows(a, b, sortKey, sortDir));
    return rows;
  }, [onDutySummary, sortKey, sortDir]);

  const toggleSort = (key: SummarySortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "totalRaw" ? "desc" : "asc");
    }
  };

  return (
    <section className="sched-section sched-stats-section">
      <h3 className="sched-section-title">Statistics</h3>

      {statsPresentation === "plan" && planOverview && (
        <PlanOverviewMetrics overview={planOverview} />
      )}

      {statsPresentation === "history" && (
        <div className="sched-global-stats glass-card">
          <h4 className="sched-subtitle">Global fairness</h4>
          <ul className="sched-global-list">
            <li>
              <span className="sched-global-k">Fairness score</span>
              <span className="sched-global-v">{stats.fairness.fairnessScore.toFixed(4)}</span>
              <span className="sched-global-hint"> (lower is fairer)</span>
            </li>
            <li>
              <span className="sched-global-k">Std all Z values</span>
              <span className="sched-global-v">{stats.fairness.stdAllZ.toFixed(4)}</span>
            </li>
            <li>
              <span className="sched-global-k">Min std across slots</span>
              <span className="sched-global-v">{stats.fairness.minStdSlotZ.toFixed(4)}</span>
            </li>
            <li>
              <span className="sched-global-k">Std raw hours (soldiers)</span>
              <span className="sched-global-v">{stats.fairness.stdRawHours.toFixed(4)}</span>
            </li>
            <li>
              <span className="sched-global-k">Raw hours spread</span>
              <span className="sched-global-v">{stats.fairness.rawHoursSpread.toFixed(2)} h</span>
            </li>
          </ul>
        </div>
      )}

      {statsPresentation === "history" ? (
        <>
          <StatLineChart
            title={`Mean raw hours per day by location — ${runTitle}`}
            yLabel="Mean raw guard hours per calendar day (h)"
            data={stats.lineChartLoc}
            seriesKeys={stats.locLabels}
          />
          <StatLineChart
            title={`Mean raw hours per day by time band — ${runTitle}`}
            yLabel="Mean raw guard hours per calendar day (h)"
            data={stats.lineChartTime}
            seriesKeys={stats.timeLabels}
          />
        </>
      ) : (
        <>
          <SoldierHoursStackedBars
            title={`Guard hours by slot type — ${runTitle}`}
            rows={onDutyByHoursDesc}
            segments={(row) => row.rawHoursBySlotType}
            segmentLabels={stats.slotTypeLabels}
            display={display}
            nameById={nameById}
            soldierIds={soldierIds}
            soldiers={soldiers}
            typesDoc={typesDoc}
          />
          <SoldierHoursStackedBars
            title={`Guard hours by time band — ${runTitle}`}
            rows={onDutyByHoursDesc}
            segments={(row) => row.rawHoursByTime}
            segmentLabels={stats.timeLabels}
            display={display}
            nameById={nameById}
            soldierIds={soldierIds}
            soldiers={soldiers}
            typesDoc={typesDoc}
          />
        </>
      )}

      <div className="sched-summary-block">
        <h4 className="sched-subtitle">Soldier summary + consecutive free time</h4>
        <p className="sched-hint">
          <strong>Max consecutive free</strong> columns: min / mean / max over simulation days (hours per day).
          <strong> Raw h by slot</strong> and <strong>Time bands</strong>: compact vectors — only positive entries as{" "}
          <code>[slot_id:hours]</code> or <code>[time_zone_index:hours]</code> (1-based); empty → <code>[]</code>.
          Soldiers with zero guard hours are listed below the table.
        </p>
        <div className="sched-table-scroll">
          <table className="sched-table sched-summary-table">
            <thead>
              <tr>
                <SortableTh label="Soldier" sortKey="soldier" activeKey={sortKey} direction={sortDir} onToggle={toggleSort} />
                <SortableTh label="Type" sortKey="type" activeKey={sortKey} direction={sortDir} onToggle={toggleSort} />
                <SortableTh label="Total raw guard h" sortKey="totalRaw" activeKey={sortKey} direction={sortDir} onToggle={toggleSort} />
                <SortableTh label="Global score" sortKey="globalScore" activeKey={sortKey} direction={sortDir} onToggle={toggleSort} />
                <SortableTh label="Raw h by slot" sortKey="rawSlot" activeKey={sortKey} direction={sortDir} onToggle={toggleSort} />
                <SortableTh label="Time bands" sortKey="timeBand" activeKey={sortKey} direction={sortDir} onToggle={toggleSort} />
                <SortableTh label="Slots" sortKey="slots" activeKey={sortKey} direction={sortDir} onToggle={toggleSort} />
                <SortableTh label="Min max free" sortKey="minFree" activeKey={sortKey} direction={sortDir} onToggle={toggleSort} />
                <SortableTh label="Mean max free" sortKey="meanFree" activeKey={sortKey} direction={sortDir} onToggle={toggleSort} />
                <SortableTh label="Max max free" sortKey="maxFree" activeKey={sortKey} direction={sortDir} onToggle={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {sortedSummary.map((row) => (
                <tr key={row.soldierIdx}>
                  <th scope="row" className="sched-summary-soldier-th">
                    <SoldierChartLabel
                      soldierIdx={row.soldierIdx}
                      display={display}
                      nameById={nameById}
                      soldierIds={soldierIds}
                      soldiers={soldiers}
                      typesDoc={typesDoc}
                      rawHoursBySlot={row.rawHoursBySlot}
                    />
                  </th>
                  <td>{row.typeCode || "—"}</td>
                  <td>{row.totalRawHours.toFixed(2)}</td>
                  <td>{row.globalScore.toFixed(4)}</td>
                  <td className="sched-num-list sched-compact-vector">{row.rawHoursBySlotCompact}</td>
                  <td className="sched-num-list sched-compact-vector">{row.timeBandHoursCompact}</td>
                  <td className="sched-num-list">
                    {row.slotIds.length > 0 ? row.slotIds.join(", ") : "—"}
                  </td>
                  <td>{row.minMaxFree.toFixed(2)}</td>
                  <td>{row.meanMaxFree.toFixed(2)}</td>
                  <td>{row.maxMaxFree.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <FreeSoldiersFooter
          freeSoldiers={freeSoldiers}
          display={display}
          nameById={nameById}
          soldierIds={soldierIds}
          soldiers={soldiers}
          typesDoc={typesDoc}
        />
      </div>

      <div className="sched-summary-block">
        <h4 className="sched-subtitle">Max consecutive free time — {runTitle}</h4>
        <p className="sched-hint">Per day, per soldier: longest contiguous off-duty span (hours).</p>
        {days > 1 && (
          <div className="sched-table-scroll">
            <table className="sched-table sched-summary-table">
              <thead>
                <tr>
                  <th>Day</th>
                  {stats.summary.map((r) => (
                    <th key={r.soldierIdx} className="sched-summary-soldier-th">
                      <SoldierChartLabel
                        soldierIdx={r.soldierIdx}
                        display={display}
                        nameById={nameById}
                        soldierIds={soldierIds}
                        soldiers={soldiers}
                        typesDoc={typesDoc}
                        rawHoursBySlot={r.rawHoursBySlot}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.maxFree.map((dayRow, d) => (
                  <tr key={d}>
                    <th scope="row">{d + 1}</th>
                    {dayRow.map((h, s) => (
                      <td key={s}>{h.toFixed(2)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

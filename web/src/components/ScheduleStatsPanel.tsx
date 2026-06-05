import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
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
import type { ScheduleStatsBundle, SoldierSummaryRow } from "../lib/scheduleReport";
import { buildSoldierProfileTooltip } from "../lib/soldierTooltip";
import type { Soldier } from "../lib/soldiers";
import type { SoldierTypesDoc } from "../lib/soldierTypes";
import { ColumnSortButton, type SortDirection } from "./ColumnSortButton";
import { SoldierHoverTooltip } from "./SoldierHoverTooltip";

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
};

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

function SoldierTypeChip({ code }: { code: string }) {
  if (!code) return null;
  return (
    <span className="sched-type-chip" title={code}>
      {code}
    </span>
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
}: Props) {
  const [sortKey, setSortKey] = useState<SummarySortKey>("totalRaw");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");

  const runTitle = useMemo(
    () => `${days}d — ${stats.soldierCount} soldiers, ${slotsPerBlock} slots/block, shift_hours=${shiftHours}h`,
    [days, stats.soldierCount, slotsPerBlock, shiftHours],
  );

  const soldierBarKeys = useMemo(
    () => Array.from({ length: stats.soldierCount }, (_, s) => `S${s}`),
    [stats.soldierCount],
  );

  const sortedSummary = useMemo(() => {
    const rows = [...stats.summary];
    rows.sort((a, b) => compareSummaryRows(a, b, sortKey, sortDir));
    return rows;
  }, [stats.summary, sortKey, sortDir]);

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

      <div className="sched-stat-chart">
        <h4 className="sched-subtitle">Max consecutive free time (per day) — {runTitle}</h4>
        <p className="sched-hint">Per day, per soldier: longest contiguous off-duty span (hours).</p>
        <div className="sched-chart-box">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={stats.maxFreeBarData} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.35} />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} label={{ value: "Max consecutive free (h)", angle: -90, position: "insideLeft", style: { fontSize: 11 } }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {soldierBarKeys.map((key, i) => (
                <Bar key={key} dataKey={key} fill={SERIES_COLORS[i % SERIES_COLORS.length]} maxBarSize={days === 1 ? 48 : 24} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="sched-summary-block">
        <h4 className="sched-subtitle">Soldier summary + consecutive free time</h4>
        <p className="sched-hint">
          <strong>Max consecutive free</strong> columns: min / mean / max over simulation days (hours per day).
          <strong> Raw h by slot</strong> and <strong>Time bands</strong>: compact vectors — only positive entries as{" "}
          <code>[slot_id:hours]</code> or <code>[time_zone_index:hours]</code> (1-based); empty → <code>[]</code>.
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
              {sortedSummary.map((row) => {
                const tooltipLines = buildSoldierProfileTooltip(
                  row.soldierIdx,
                  row.rawHoursBySlot,
                  soldierIds,
                  soldiers,
                  typesDoc,
                );
                return (
                  <tr key={row.soldierIdx}>
                    <th scope="row">
                      <SoldierHoverTooltip lines={tooltipLines}>
                        <span className="sched-summary-soldier-cell">
                          <SoldierTypeChip code={row.typeCode} />
                          <span>{row.label}</span>
                        </span>
                      </SoldierHoverTooltip>
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
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {days > 1 && (
        <div className="sched-summary-block">
          <h4 className="sched-subtitle">Max consecutive free — numeric (day × soldier)</h4>
          <div className="sched-table-scroll">
            <table className="sched-table sched-summary-table">
              <thead>
                <tr>
                  <th>Day</th>
                  {stats.summary.map((r) => (
                    <th key={r.soldierIdx}>{r.label}</th>
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
        </div>
      )}
    </section>
  );
}

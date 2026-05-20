import { useMemo } from "react";
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
import type { ScheduleStatsBundle } from "../lib/scheduleReport";

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

type Props = {
  stats: ScheduleStatsBundle;
  days: number;
  shiftHours: number;
  slotsPerBlock: number;
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

export function ScheduleStatsPanel({ stats, days, shiftHours, slotsPerBlock }: Props) {
  const runTitle = useMemo(
    () => `${days}d — ${stats.soldierCount} soldiers, ${slotsPerBlock} slots/block, shift_hours=${shiftHours}h`,
    [days, stats.soldierCount, slotsPerBlock, shiftHours],
  );

  const soldierBarKeys = useMemo(
    () => Array.from({ length: stats.soldierCount }, (_, s) => `S${s}`),
    [stats.soldierCount],
  );

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
          <strong> Time bands</strong>: percent of that soldier&apos;s total raw guard hours (sums to 100%).
        </p>
        <div className="sched-table-scroll">
          <table className="sched-table sched-summary-table">
            <thead>
              <tr>
                <th>Soldier</th>
                <th>Total raw guard h</th>
                <th>Global score</th>
                <th>Raw h by loc</th>
                <th>Time bands (%)</th>
                <th>Min max free</th>
                <th>Mean max free</th>
                <th>Max max free</th>
              </tr>
            </thead>
            <tbody>
              {stats.summary.map((row) => (
                <tr key={row.soldierIdx}>
                  <th scope="row">{row.label}</th>
                  <td>{row.totalRawHours.toFixed(2)}</td>
                  <td>{row.globalScore.toFixed(4)}</td>
                  <td className="sched-num-list">
                    {row.rawHoursByLoc.map((h) => h.toFixed(1)).join(", ")}
                  </td>
                  <td className="sched-num-list">
                    {row.timeBandPct.map((p) => `${p.toFixed(2)}%`).join(", ")}
                  </td>
                  <td>{row.minMaxFree.toFixed(2)}</td>
                  <td>{row.meanMaxFree.toFixed(2)}</td>
                  <td>{row.maxMaxFree.toFixed(2)}</td>
                </tr>
              ))}
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

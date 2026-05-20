import { Download } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiGet } from "../api";
import { useZonesDocument } from "../context/ZonesDocumentContext";
import { downloadTextFile, scheduleRowsToYaml } from "../lib/scheduleExport";
import { buildScheduleStats, buildZoneReportView, inferSoldierCount } from "../lib/scheduleReport";
import {
  scheduleDayCount,
  scheduleRowsToAssignments,
  type ScheduleReportRow,
} from "../lib/scheduleRows";
import { ScheduleResultsReport, soldiersFromCfg } from "./ScheduleResultsReport";
import { ScheduleStatsPanel } from "./ScheduleStatsPanel";

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function rangeFromEndAndBack(endDate: string, daysBack: number): { from: string; to: string } {
  const end = new Date(`${endDate}T00:00:00Z`);
  const from = new Date(end);
  const back = Math.max(0, Math.floor(daysBack));
  from.setUTCDate(from.getUTCDate() - back);
  return {
    from: from.toISOString().slice(0, 10),
    to: endDate.slice(0, 10),
  };
}

export function StatsView() {
  const { doc: zonesDoc, slotsQ } = useZonesDocument();
  const [endDate, setEndDate] = useState(todayUTC);
  const [daysBack, setDaysBack] = useState(14);
  const [showDayMatrix, setShowDayMatrix] = useState(false);

  const { from, to } = useMemo(() => rangeFromEndAndBack(endDate, daysBack), [endDate, daysBack]);

  const soldiersQ = useQuery({
    queryKey: ["cfg", "soldiers"],
    queryFn: () =>
      apiGet<{ value: { soldiers?: { id?: string; key?: string; state?: string }[] } }>(
        "/api/cfg/soldiers"
      ),
  });

  const scheduleQ = useQuery({
    queryKey: ["reports", "schedule", from, to],
    queryFn: () =>
      apiGet<ScheduleReportRow[]>(
        `/api/reports/schedule?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      ),
  });

  const blocksQ = useQuery({
    queryKey: ["reports", "blocks", from, to],
    queryFn: () =>
      apiGet<{ soldier_id: string; ts_date: string; blocks: number }[]>(
        `/api/reports/blocks?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      ),
  });

  const soldierIds = useMemo(() => {
    const list = soldiersQ.data?.value?.soldiers ?? [];
    return list
      .map((s) => s.id || s.key || "")
      .filter((id) => {
        if (!id) return false;
        const st = (list.find((x) => (x.id || x.key) === id)?.state ?? "").toLowerCase();
        return !st || st === "base";
      });
  }, [soldiersQ.data]);

  const soldiers = useMemo(
    () => soldiersFromCfg(soldiersQ.data?.value),
    [soldiersQ.data]
  );

  const assignments = useMemo(() => {
    if (!zonesDoc || !scheduleQ.data?.length) return [];
    return scheduleRowsToAssignments(scheduleQ.data, zonesDoc, soldierIds);
  }, [scheduleQ.data, zonesDoc, soldierIds]);

  const scheduleDays = useMemo(() => {
    if (!scheduleQ.data?.length) return 0;
    return scheduleDayCount(scheduleQ.data, assignments);
  }, [scheduleQ.data, assignments]);

  const stats = useMemo(() => {
    if (!zonesDoc || assignments.length === 0) return null;
    const zone = buildZoneReportView(zonesDoc, zonesDoc.slots.length);
    const soldierCount = inferSoldierCount(assignments);
    return buildScheduleStats(assignments, scheduleDays, zone, soldierCount);
  }, [assignments, zonesDoc, scheduleDays]);

  const chartData = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of blocksQ.data ?? []) {
      m.set(r.soldier_id, (m.get(r.soldier_id) ?? 0) + Number(r.blocks));
    }
    return [...m.entries()].map(([soldier_id, blocks]) => ({ soldier_id, blocks }));
  }, [blocksQ.data]);

  const downloadYaml = () => {
    const rows = scheduleQ.data ?? [];
    const yaml = scheduleRowsToYaml(rows, from, to);
    downloadTextFile(`schedule-${from}_to_${to}.yaml`, yaml);
  };

  return (
    <div className="stats-layout">
      <section className="glass-card panel stats-panel">
        <h2 className="contacts-title" style={{ margin: "0 0 0.5rem" }}>
          Verified schedule stats
        </h2>
        <p className="contacts-hint" style={{ margin: "0 0 1rem" }}>
          History from the applied schedule (not proposals). Range is inclusive: end date minus days back
          through end date.
        </p>

        <div className="stats-range-form">
          <label className="stats-range-field">
            <span className="title">End date</span>
            <span className="hint">default today (UTC)</span>
            <input
              className="settings-input settings-input-wide"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </label>
          <label className="stats-range-field">
            <span className="title">Days back</span>
            <span className="hint">e.g. 10 → {rangeFromEndAndBack(endDate, 10).from} … {endDate}</span>
            <input
              className="settings-input"
              type="number"
              min={0}
              max={366}
              value={daysBack}
              onChange={(e) => setDaysBack(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
            />
          </label>
        </div>

        <p className="stats-range-summary">
          Showing <strong>{from}</strong> through <strong>{to}</strong>
          {scheduleQ.data != null ? ` · ${scheduleQ.data.length} duty rows` : null}
        </p>

        <div className="stats-toolbar">
          <label className="stats-show-matrix">
            <input
              type="checkbox"
              checked={showDayMatrix}
              onChange={(e) => setShowDayMatrix(e.target.checked)}
              disabled={!assignments.length || !zonesDoc}
            />
            <span>Show schedule by day (assignments per day)</span>
          </label>
          <button
            type="button"
            className="btn btn-tinted"
            disabled={!scheduleQ.data?.length}
            onClick={downloadYaml}
          >
            <Download size={16} />
            Download YAML
          </button>
        </div>

        {scheduleQ.isLoading && <p>Loading schedule…</p>}
        {scheduleQ.isError && <p className="msg-err">{(scheduleQ.error as Error).message}</p>}
        {scheduleQ.data?.length === 0 && !scheduleQ.isLoading && (
          <p className="contacts-empty">No verified schedule rows in this range. Apply a plan first.</p>
        )}

        {chartData.length > 0 && (
          <div className="stats-chart-block">
            <p className="sub">Block counts per soldier (aggregated).</p>
            <div style={{ width: "100%", height: 320 }}>
              <ResponsiveContainer>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="soldier_id" angle={-25} textAnchor="end" height={80} interval={0} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="blocks" fill="#0ea5e9" name="Blocks" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {showDayMatrix && assignments.length > 0 && zonesDoc && !slotsQ.isLoading && (
          <div className="stats-day-matrix">
            <ScheduleResultsReport
              assignments={assignments}
              days={scheduleDays}
              shiftHours={zonesDoc.shift_hours}
              zones={zonesDoc}
              soldierIds={soldierIds}
              soldiers={soldiers}
              sections={{
                matrixShort: true,
                matrixFull: true,
                bySoldier: false,
                timeline: false,
                statsPanel: false,
              }}
            />
          </div>
        )}

        {stats && zonesDoc && !slotsQ.isLoading && (
          <ScheduleStatsPanel
            stats={stats}
            days={scheduleDays}
            shiftHours={zonesDoc.shift_hours}
            slotsPerBlock={zonesDoc.slots.length}
          />
        )}
      </section>
    </div>
  );
}

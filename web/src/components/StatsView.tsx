import { ChevronLeft, ChevronRight, Download, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
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
import { deleteVerifiedScheduleDay } from "../api/plan";
import { useZonesDocument } from "../context/ZonesDocumentContext";
import { fetchVerifiedPlan, slicePlanToVerifiedDate, type PlanDoc } from "../lib/planDoc";
import {
  formatVerifiedDayLabel,
  verifiedDatesInPlan,
  verifiedDayChipParts,
} from "../lib/verifiedPlanView";
import {
  downloadPlanMatrixXls,
  planMatrixXlsFilenameForScheduleDay,
} from "../lib/planMatrixExport";
import { downloadTextFile, planDocToYaml } from "../lib/scheduleExport";
import { parsePlatoonColorsFromGlobal } from "../lib/platoonColors";
import { PlanDocView } from "./PlanDocView";
import { fetchPreviewAvailabilityByDays } from "./SoldiersStatusBoard";
import { soldiersFromCfg } from "./ScheduleResultsReport";
import { todayFakeUtcDate } from "../lib/wallClock";

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

const STATS_REPORT_SECTIONS = {
  matrixShort: true,
  matrixFull: true,
  bySoldier: false,
  timeline: true,
  statsPanel: true,
} as const;

type StatsViewProps = {
  isAdmin?: boolean;
};

export function StatsView({ isAdmin = false }: StatsViewProps) {
  const qc = useQueryClient();
  const { doc: zonesDoc, slotsQ } = useZonesDocument();
  const [endDate, setEndDate] = useState(todayFakeUtcDate);
  const [daysBack, setDaysBack] = useState(14);
  const [showDayMatrix, setShowDayMatrix] = useState(false);
  const [deleteDate, setDeleteDate] = useState("");
  const [deleteStatus, setDeleteStatus] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [viewDate, setViewDate] = useState("");

  const { from, to } = useMemo(() => rangeFromEndAndBack(endDate, daysBack), [endDate, daysBack]);

  const soldiersQ = useQuery({
    queryKey: ["cfg", "soldiers"],
    queryFn: () =>
      apiGet<{ value: { soldiers?: { id?: string; key?: string; state?: string }[] } }>(
        "/api/cfg/soldiers"
      ),
  });

  const globalQ = useQuery({
    queryKey: ["cfg", "global"],
    queryFn: () => apiGet<{ value: unknown }>("/api/cfg/global"),
  });

  const platoonColors = useMemo(
    () => parsePlatoonColorsFromGlobal(globalQ.data?.value),
    [globalQ.data]
  );

  const scheduleQ = useQuery({
    queryKey: ["reports", "schedule", from, to],
    queryFn: () => fetchVerifiedPlan(from, to),
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
    return list.map((s) => s.id || s.key || "").filter(Boolean);
  }, [soldiersQ.data]);

  const soldiers = useMemo(
    () => soldiersFromCfg(soldiersQ.data?.value),
    [soldiersQ.data]
  );

  const plan: PlanDoc | null = scheduleQ.data ?? null;
  const hasSchedule = (plan?.assignments.length ?? 0) > 0;

  const chartData = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of blocksQ.data ?? []) {
      m.set(r.soldier_id, (m.get(r.soldier_id) ?? 0) + Number(r.blocks));
    }
    return [...m.entries()].map(([soldier_id, blocks]) => ({ soldier_id, blocks }));
  }, [blocksQ.data]);

  const verifiedDates = useMemo(() => {
    const fromPlan = plan ? verifiedDatesInPlan(plan) : [];
    if (fromPlan.length > 0) return fromPlan;
    const dates = new Set<string>();
    for (const r of blocksQ.data ?? []) {
      dates.add(r.ts_date.slice(0, 10));
    }
    return [...dates].sort();
  }, [blocksQ.data, plan]);

  useEffect(() => {
    if (verifiedDates.length === 0) {
      setViewDate("");
      return;
    }
    setViewDate((prev) => {
      if (prev && verifiedDates.includes(prev)) return prev;
      return verifiedDates[verifiedDates.length - 1] ?? "";
    });
  }, [verifiedDates]);

  const viewDateIndex = viewDate ? verifiedDates.indexOf(viewDate) : -1;

  const viewDayAvailQ = useQuery({
    queryKey: ["plan", "preview-availability", viewDate, 1],
    queryFn: () => fetchPreviewAvailabilityByDays(viewDate, 1),
    enabled: showDayMatrix && Boolean(viewDate),
    staleTime: 0,
  });

  const planForReport = useMemo(() => {
    if (!plan || !showDayMatrix || !viewDate) return plan;
    return slicePlanToVerifiedDate(plan, viewDate) ?? plan;
  }, [plan, showDayMatrix, viewDate]);

  const viewDayLabel =
    plan && viewDate ? formatVerifiedDayLabel(viewDate, plan, globalQ.data?.value) : "";

  useEffect(() => {
    if (!isAdmin) return;
    if (verifiedDates.length === 0) {
      setDeleteDate("");
      return;
    }
    setDeleteDate((prev) => {
      if (prev && verifiedDates.includes(prev)) return prev;
      return verifiedDates[verifiedDates.length - 1] ?? "";
    });
  }, [isAdmin, verifiedDates]);

  const deleteDayM = useMutation({
    mutationFn: (date: string) => deleteVerifiedScheduleDay(date),
    onSuccess: (_data, date) => {
      setDeleteStatus(`Removed verified schedule for ${date}.`);
      setDeleteError(null);
      void qc.invalidateQueries({ queryKey: ["reports", "schedule"] });
      void qc.invalidateQueries({ queryKey: ["reports", "blocks"] });
    },
    onError: (e) => {
      setDeleteStatus(null);
      setDeleteError(e instanceof Error ? e.message : "Delete failed");
    },
  });

  const handleDeleteVerifiedDay = () => {
    if (!deleteDate) return;
    const blocksOnDay = (blocksQ.data ?? []).filter(
      (r) => r.ts_date.slice(0, 10) === deleteDate
    ).length;
    const msg = [
      `Remove verified schedule for ${deleteDate}?`,
      "",
      "This permanently deletes that calendar day from schedule history.",
      blocksOnDay > 0
        ? `About ${blocksOnDay} duty block(s) on this day will be removed.`
        : "No duty blocks were found for this day in the current range (it may already be empty).",
      "",
      "After removal you can apply a new plan for this date on the Plan tab.",
      "",
      "This cannot be undone.",
    ].join("\n");
    if (!window.confirm(msg)) return;
    setDeleteStatus(null);
    setDeleteError(null);
    deleteDayM.mutate(deleteDate);
  };

  const downloadYaml = () => {
    if (!plan) return;
    const yaml = planDocToYaml(plan, from, to);
    downloadTextFile(`schedule-${from}_to_${to}.yaml`, yaml);
  };

  const handleDownloadExcel = () => {
    if (!planForReport || !zonesDoc) return;
    const date = showDayMatrix && viewDate ? viewDate : to;
    downloadPlanMatrixXls(
      {
        plan: planForReport,
        zones: zonesDoc,
        soldierIds,
        soldiers,
        platoonColors,
      },
      planMatrixXlsFilenameForScheduleDay(date),
    );
  };

  const canDownloadMatrixExcel =
    hasSchedule && !!planForReport && !!zonesDoc && !slotsQ.isLoading && showDayMatrix;

  const reportSections = showDayMatrix
    ? STATS_REPORT_SECTIONS
    : { ...STATS_REPORT_SECTIONS, matrixShort: false, matrixFull: false, timeline: false };

  return (
    <div className="stats-layout">
      <section className="glass-card panel stats-panel">
        <h2 className="contacts-title" style={{ margin: "0 0 0.5rem" }}>
          Verified schedule stats
        </h2>
        <p className="contacts-hint" style={{ margin: "0 0 1rem" }}>
          History from the applied schedule (not proposals). Same plan JSON as Plan. Range is inclusive: end date minus
          days back through end date.
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
          Showing fetch range <strong>{from}</strong> through <strong>{to}</strong>
          {verifiedDates.length > 0 ? (
            <>
              {" "}
              · verified day{verifiedDates.length === 1 ? "" : "s"}:{" "}
              <strong>{verifiedDates.join(", ")}</strong>
            </>
          ) : null}
          {plan != null ? ` · ${plan.assignments.length} assignment(s) in range` : null}
        </p>

        <div className="stats-toolbar">
          <label className="stats-show-matrix">
            <input
              type="checkbox"
              checked={showDayMatrix}
              onChange={(e) => setShowDayMatrix(e.target.checked)}
              disabled={!hasSchedule || !zonesDoc}
            />
            <span>Show schedule matrix</span>
          </label>
          <button
            type="button"
            className="btn btn-tinted"
            disabled={!hasSchedule}
            onClick={downloadYaml}
          >
            <Download size={16} />
            Download YAML
          </button>
          <button
            type="button"
            className="btn btn-tinted"
            disabled={!canDownloadMatrixExcel}
            onClick={handleDownloadExcel}
            title="Download schedule matrix (full names, platoon colors) as Excel"
          >
            <Download size={16} />
            Download Excel
          </button>
        </div>

        {isAdmin && (
          <div className="stats-admin-delete glass-card panel" style={{ marginTop: "1rem" }}>
            <h3 className="sched-subtitle" style={{ margin: "0 0 0.35rem" }}>
              Remove verified day (admin)
            </h3>
            <p className="contacts-hint" style={{ margin: "0 0 0.75rem" }}>
              Delete one calendar day from schedule history so you can apply a plan again for that date. Requires
              confirmation.
            </p>
            <div className="stats-range-form">
              <label className="stats-range-field">
                <span className="title">Day to remove</span>
                <span className="hint">
                  {verifiedDates.length > 0
                    ? `Dates with data in range: ${verifiedDates.join(", ")}`
                    : "Pick a date (YYYY-MM-DD)"}
                </span>
                {verifiedDates.length > 0 ? (
                  <select
                    className="settings-input settings-input-wide"
                    value={deleteDate}
                    onChange={(e) => setDeleteDate(e.target.value)}
                  >
                    {verifiedDates.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="settings-input settings-input-wide"
                    type="date"
                    min={from}
                    max={to}
                    value={deleteDate}
                    onChange={(e) => setDeleteDate(e.target.value)}
                  />
                )}
              </label>
            </div>
            <button
              type="button"
              className="btn btn-destructive"
              disabled={!deleteDate || deleteDayM.isPending}
              onClick={handleDeleteVerifiedDay}
            >
              <Trash2 size={16} />
              {deleteDayM.isPending ? "Removing…" : "Remove day from history"}
            </button>
            {deleteStatus && <p className="msg-ok" style={{ marginTop: "0.75rem" }}>{deleteStatus}</p>}
            {deleteError && <p className="msg-err" style={{ marginTop: "0.75rem" }}>{deleteError}</p>}
          </div>
        )}

        {scheduleQ.isLoading && <p>Loading schedule…</p>}
        {scheduleQ.isError && <p className="msg-err">{(scheduleQ.error as Error).message}</p>}
        {plan && !hasSchedule && !scheduleQ.isLoading && (
          <p className="contacts-empty">No verified schedule in this range. Apply a plan first.</p>
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

        {showDayMatrix && hasSchedule && verifiedDates.length > 0 && (
          <div className="stats-day-nav glass-card panel">
            <span className="stats-day-nav-label">Verified plan day</span>
            <div className="stats-day-nav-controls">
              <button
                type="button"
                className="btn btn-tinted stats-day-nav-btn"
                disabled={viewDateIndex <= 0}
                aria-label="Previous verified day"
                title="Previous verified day"
                onClick={() => {
                  if (viewDateIndex > 0) setViewDate(verifiedDates[viewDateIndex - 1]!);
                }}
              >
                <ChevronLeft size={18} strokeWidth={2.5} />
              </button>
              <div className="stats-day-nav-center">
                <strong className="stats-day-nav-date">{viewDayLabel || viewDate}</strong>
                {verifiedDates.length > 1 ? (
                  <span className="hint">
                    {viewDateIndex + 1} of {verifiedDates.length}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                className="btn btn-tinted stats-day-nav-btn"
                disabled={viewDateIndex < 0 || viewDateIndex >= verifiedDates.length - 1}
                aria-label="Next verified day"
                title="Next verified day"
                onClick={() => {
                  if (viewDateIndex >= 0 && viewDateIndex < verifiedDates.length - 1) {
                    setViewDate(verifiedDates[viewDateIndex + 1]!);
                  }
                }}
              >
                <ChevronRight size={18} strokeWidth={2.5} />
              </button>
            </div>
            {verifiedDates.length > 1 ? (
              <div className="stats-day-chips">
                {verifiedDates.map((d) => {
                  const chip = plan
                    ? verifiedDayChipParts(d, plan, globalQ.data?.value)
                    : { weekday: "", date: d };
                  return (
                    <button
                      key={d}
                      type="button"
                      className={`stats-day-chip${d === viewDate ? " stats-day-chip-active" : ""}`}
                      onClick={() => setViewDate(d)}
                      title={plan ? formatVerifiedDayLabel(d, plan, globalQ.data?.value) : d}
                    >
                      <span className="stats-day-chip-wd">{chip.weekday}</span>
                      <span className="stats-day-chip-date">{chip.date}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        )}

        {hasSchedule && planForReport && zonesDoc && !slotsQ.isLoading && (
          <div className="stats-plan-report">
            <PlanDocView
              plan={planForReport}
              zones={zonesDoc}
              soldierIds={soldierIds}
              soldiers={soldiers}
              platoonColors={platoonColors}
              sections={reportSections}
              soldiersByDay={showDayMatrix ? viewDayAvailQ.data : undefined}
            />
          </div>
        )}
      </section>
    </div>
  );
}

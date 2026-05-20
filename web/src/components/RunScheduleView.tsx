import { Copy } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { apiGet, callApi } from "../api";
import { fetchPlanContext, type PlanContext } from "../api/plan";
import { useZonesDocument } from "../context/ZonesDocumentContext";
import { planDebugDayOffsetFromValue } from "../lib/globalConfig";
import type { ScheduleAssignment } from "../lib/scheduleReport";
import { ALLOWED_SHIFT_HOURS, validateShiftHours } from "../lib/zones";
import { ScheduleResultsReport, soldiersFromCfg } from "./ScheduleResultsReport";

export type ScheduleRunParams = {
  anchor_date: string;
  days: number;
  shift_hours?: number;
  min_consecutive_free_hours: number;
  min_free_shifts_after_duty: number;
  band_relative: number;
  sim_trials: number;
  seed?: number;
};

export type ScheduleRunResult = {
  ok: boolean;
  days: number;
  anchor_date: string;
  shift_hours: number;
  assignments: ScheduleAssignment[];
  count: number;
  meta?: Record<string, unknown>;
  error?: string;
};

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="run-field">
      <span className="run-field-label">
        <span className="title">{label}</span>
        {hint ? <span className="hint">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

export function RunScheduleView() {
  const { doc: zonesDoc, slotsQ, loadError: zonesLoadError } = useZonesDocument();
  const zonesLoading = slotsQ.isLoading;
  const globalQ = useQuery({
    queryKey: ["cfg", "global"],
    queryFn: () => apiGet<{ value: unknown }>("/api/cfg/global"),
  });
  const debugDayOffset = planDebugDayOffsetFromValue(globalQ.data?.value);
  const planCtxQ = useQuery({
    queryKey: ["plan", "context", debugDayOffset],
    queryFn: () => fetchPlanContext(debugDayOffset > 0 ? debugDayOffset : undefined),
  });
  const soldiersQ = useQuery({
    queryKey: ["cfg", "soldiers"],
    queryFn: () =>
      apiGet<{ value: { soldiers?: { id?: string; key?: string; state?: string }[] } }>(
        "/api/cfg/soldiers"
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
  const planCtx: PlanContext | undefined = planCtxQ.data;
  const [anchor, setAnchor] = useState("");
  const [days, setDays] = useState(1);
  const [shiftHours, setShiftHours] = useState<number | "">("");
  const [minFreeHours, setMinFreeHours] = useState(6);
  const [minFreeShifts, setMinFreeShifts] = useState(2);
  const [bandRelative, setBandRelative] = useState(0.2);
  const [simTrials, setSimTrials] = useState(1);
  const [seed, setSeed] = useState("");
  const [result, setResult] = useState<ScheduleRunResult | null>(null);

  useEffect(() => {
    if (!planCtx?.plan_anchor) return;
    setAnchor(planCtx.plan_anchor);
  }, [planCtx?.plan_anchor]);

  const runM = useMutation({
    mutationFn: async () => {
      const trials = Math.max(1, Math.floor(simTrials));
      const seedTrim = seed.trim();
      if (trials > 1 && !seedTrim) {
        throw new Error("Seed is required when sim trials > 1");
      }
      const body: ScheduleRunParams = {
        anchor_date: anchor,
        days: Math.max(1, days),
        min_consecutive_free_hours: minFreeHours,
        min_free_shifts_after_duty: Math.max(0, Math.floor(minFreeShifts)),
        band_relative: bandRelative,
        sim_trials: trials,
      };
      if (shiftHours !== "") {
        body.shift_hours = validateShiftHours(shiftHours);
      }
      if (seedTrim) {
        const s = Number(seedTrim);
        if (!Number.isFinite(s) || !Number.isInteger(s)) {
          throw new Error("Seed must be an integer");
        }
        body.seed = s;
      }
      return callApi<ScheduleRunResult>("/api/schedule/run", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    onSuccess: (data) => setResult(data),
    onError: (e) => {
      let msg = e instanceof Error ? e.message : "Run failed";
      try {
        const parsed = JSON.parse(msg) as { error?: string };
        if (parsed.error) msg = parsed.error;
      } catch {
        /* keep msg */
      }
      setResult({ ok: false, days, anchor_date: anchor, shift_hours: 0, assignments: [], count: 0, error: msg });
    },
  });

  const copyResult = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="run-schedule-layout">
      <section className="glass-card run-form-card">
        <h2 className="contacts-title" style={{ padding: "0.85rem 1.1rem 0.25rem", margin: 0 }}>
          Run schedule
        </h2>
        <p className="contacts-hint" style={{ margin: "0 0 0.75rem", padding: "0 1.1rem" }}>
          Same flags as the CLI sim. Planning anchor is the next day after effective today (UTC). Results are saved
          to the database and shown below as tables and charts.
        </p>

        {planCtx && (
          <p className="contacts-hint" style={{ margin: "0 0 0.75rem", padding: "0 1.1rem" }}>
            Effective today: <strong>{planCtx.effective_today}</strong> · plan anchor:{" "}
            <strong>{planCtx.plan_anchor}</strong>
            {planCtx.debug_day_offset > 0 ? ` (+${planCtx.debug_day_offset}d debug)` : null}
          </p>
        )}

        <div className="run-form-grid">
          <Field label="Anchor date" hint="Next planning day (UTC); set in Global → Planning (debug)">
            <input className="settings-input settings-input-wide" type="text" value={anchor} readOnly />
          </Field>

          <Field label="Days" hint="default 1">
            <input
              className="settings-input"
              type="number"
              min={1}
              max={90}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            />
          </Field>

          <Field label="Shift hours" hint="omit = zones YAML">
            <select
              className="settings-input settings-input-wide"
              value={shiftHours === "" ? "" : shiftHours}
              onChange={(e) => {
                const v = e.target.value;
                setShiftHours(v === "" ? "" : validateShiftHours(Number(v)));
              }}
            >
              <option value="">From zones YAML</option>
              {ALLOWED_SHIFT_HOURS.map((h) => (
                <option key={h} value={h}>
                  {h} h
                </option>
              ))}
            </select>
          </Field>

          <Field label="Min consecutive free hours" hint="--min-consecutive-free-hours">
            <input
              className="settings-input"
              type="number"
              min={0}
              step={0.5}
              value={minFreeHours}
              onChange={(e) => setMinFreeHours(Number(e.target.value))}
            />
          </Field>

          <Field label="Min free shifts after duty" hint="--min-free-shifts-after-duty">
            <input
              className="settings-input"
              type="number"
              min={0}
              value={minFreeShifts}
              onChange={(e) => setMinFreeShifts(Number(e.target.value))}
            />
          </Field>

          <Field label="Band relative" hint="--band-relative R">
            <input
              className="settings-input"
              type="number"
              min={0}
              step={0.05}
              value={bandRelative}
              onChange={(e) => setBandRelative(Number(e.target.value))}
            />
          </Field>

          <Field label="Sim trials" hint="--sim-trials N">
            <input
              className="settings-input"
              type="number"
              min={1}
              value={simTrials}
              onChange={(e) => setSimTrials(Number(e.target.value))}
            />
          </Field>

          <Field label="Seed" hint="--seed (required if trials > 1)">
            <input
              className="settings-input settings-input-wide"
              type="text"
              inputMode="numeric"
              placeholder="optional"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
            />
          </Field>
        </div>

        <div className="run-form-actions">
          <button
            type="button"
            className="btn btn-filled"
            disabled={runM.isPending || !anchor || planCtxQ.isLoading}
            onClick={() => runM.mutate()}
          >
            {runM.isPending ? "Running…" : "Run schedule"}
          </button>
        </div>
      </section>

      <section className={`run-results-panel${result ? " has-data" : ""}`} aria-label="Run results">
        <header className="run-results-header">
          <h3>Results</h3>
          {result && (
            <span className="run-results-meta">
              {result.ok ? `${result.count} assignments` : "Error"}
            </span>
          )}
          <button type="button" className="btn btn-tinted" disabled={!result} onClick={() => void copyResult()} aria-label="Copy JSON">
            <Copy size={16} />
            Copy
          </button>
        </header>
        <div className="run-results-body">
          {!result && <p className="contacts-empty">Run the scheduler to see the schedule matrix and timelines here.</p>}
          {result?.ok && zonesLoading && (
            <p className="contacts-empty">Loading zones configuration…</p>
          )}
          {result?.ok && !zonesLoading && zonesLoadError && (
            <p className="msg-err">Cannot render schedule tables: {zonesLoadError}</p>
          )}
          {result?.ok && !zonesLoading && zonesDoc && result.assignments.length > 0 && (
            <ScheduleResultsReport
              assignments={result.assignments}
              days={result.days}
              shiftHours={result.shift_hours}
              zones={zonesDoc}
              meta={result.meta}
              soldierIds={soldierIds}
              soldiers={soldiers}
            />
          )}
          {result?.ok && !zonesLoading && zonesDoc && result.assignments.length === 0 && (
            <p className="contacts-empty">No assignments returned.</p>
          )}
          {result && !result.ok && (
            <p className="msg-err">{result.error ?? "Schedule run failed"}</p>
          )}
        </div>
      </section>
    </div>
  );
}

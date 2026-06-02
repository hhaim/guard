import { Copy, Download } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiGet } from "../api";
import {
  applyPlan,
  clearProposal,
  fetchPlanContext,
  generatePlan,
  getProposal,
  listProposals,
  saveProposal,
  type PlanGenerateParams,
  type PlanDoc,
} from "../api/plan";
import { useZonesDocument } from "../context/ZonesDocumentContext";
import { parsePlatoonColorsFromGlobal } from "../lib/platoonColors";
import { planDocFromGenerate } from "../lib/planDoc";
import { ALLOWED_SHIFT_HOURS, validateShiftHours } from "../lib/zones";
import { downloadPlanMatrixXls, planMatrixXlsFilenameForProposal } from "../lib/planMatrixExport";
import { downloadPlanReportPdf } from "../lib/planPdfExport";
import { PlanDocView } from "./PlanDocView";
import {
  AvailabilityBadges,
  fetchPreviewAvailabilityByDays,
  type PlanDaySoldiers,
} from "./SoldiersStatusBoard";
import { soldiersFromCfg, type ScheduleReportSections } from "./ScheduleResultsReport";

const SLOT_KEY = "guard-plan-slot";

/** Plan tab: matrix (ids + full names) + stats; skip timeline/full roster (heavy with 80+ soldiers). */
const PLAN_TAB_PREVIEW_SECTIONS: ScheduleReportSections = {
  matrixShort: true,
  matrixFull: true,
  bySoldier: false,
  timeline: false,
  statsPanel: true,
  availability: false,
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

export function PlanView({
  readOnly = false,
  onOpenHelp,
}: {
  readOnly?: boolean;
  onOpenHelp?: (sectionId?: string) => void;
}) {
  const qc = useQueryClient();
  const { doc: zonesDoc, slotsQ, loadError: zonesLoadError } = useZonesDocument();
  const zonesLoading = slotsQ.isLoading;

  const [debugDayOffset, setDebugDayOffset] = useState(0);
  const planCtxQ = useQuery({
    queryKey: ["plan", "context", debugDayOffset],
    queryFn: () => fetchPlanContext(debugDayOffset > 0 ? debugDayOffset : undefined),
  });
  const anchor = planCtxQ.data?.plan_anchor ?? "";
  const offsetMatchesCtx =
    planCtxQ.data != null &&
    planCtxQ.data.request_day_offset === (debugDayOffset > 0 ? debugDayOffset : 0);
  const planContextReady = Boolean(anchor) && offsetMatchesCtx;
  const loadSeqRef = useRef(0);

  const [selectedSlot, setSelectedSlot] = useState(() => {
    try {
      return sessionStorage.getItem(SLOT_KEY) ?? "01";
    } catch {
      return "01";
    }
  });
  const [days, setDays] = useState(1);
  const [shiftHours, setShiftHours] = useState<number | "">("");
  const [minFreeHours, setMinFreeHours] = useState(6);
  const [minFreeShifts, setMinFreeShifts] = useState(2);
  const [bandRelative, setBandRelative] = useState(0.2);
  const [simTrials, setSimTrials] = useState(1);
  const [seed, setSeed] = useState("");
  const [proposal, setProposal] = useState<PlanDoc | null>(null);
  const [cfgVersion, setCfgVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [slotLoading, setSlotLoading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const requestDebugOffset = debugDayOffset > 0 ? debugDayOffset : undefined;

  const proposalsQ = useQuery({
    queryKey: ["plan", "proposals", anchor, debugDayOffset],
    queryFn: () => listProposals(anchor, requestDebugOffset),
    enabled: planContextReady,
  });

  const soldiersQ = useQuery({
    queryKey: ["cfg", "soldiers"],
    queryFn: () =>
      apiGet<{ value: { soldiers?: { id?: string; key?: string; state?: string; platoon_code?: string }[] } }>(
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

  const soldierIds = useMemo(() => {
    const list = soldiersQ.data?.value?.soldiers ?? [];
    return list.map((s) => s.id || s.key || "").filter(Boolean);
  }, [soldiersQ.data]);

  const soldiers = useMemo(
    () => soldiersFromCfg(soldiersQ.data?.value),
    [soldiersQ.data]
  );

  const slotInfo = proposalsQ.data?.slots.find((s) => s.slot === selectedSlot);
  const slotFilled = Boolean(slotInfo?.exists);

  const previewAvailQ = useQuery({
    queryKey: ["plan", "preview-availability", anchor, days],
    queryFn: () => fetchPreviewAvailabilityByDays(anchor, days),
    enabled: planContextReady && days >= 1,
    staleTime: 0,
  });

  const availabilityByDay = useMemo((): Record<string, PlanDaySoldiers> | undefined => {
    const preview = previewAvailQ.data;
    const fromProposal = proposal?.soldiers;
    if (!preview && !fromProposal) return undefined;
    const out: Record<string, PlanDaySoldiers> = fromProposal ? { ...fromProposal } : {};
    if (preview) {
      for (const [date, day] of Object.entries(preview)) {
        out[date] = day;
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }, [previewAvailQ.data, proposal?.soldiers]);

  const previewProposal =
    proposal && anchor && proposal.anchor_date === anchor ? proposal : null;

  const loadSlot = useCallback(
    async (slot: string, opts?: { silent?: boolean }) => {
      if (!anchor) return;
      const seq = ++loadSeqRef.current;
      if (!opts?.silent) setErrorMsg(null);
      setSlotLoading(true);
      try {
        const data = await getProposal(anchor, slot, requestDebugOffset);
        if (seq !== loadSeqRef.current) return;
        setProposal(data.proposal);
        setCfgVersion(data.version);
        setDirty(false);
      } catch {
        if (seq !== loadSeqRef.current) return;
        setProposal(null);
        setCfgVersion(0);
        setDirty(false);
      } finally {
        if (seq === loadSeqRef.current) setSlotLoading(false);
      }
    },
    [anchor, requestDebugOffset]
  );

  const selectSlot = (slot: string) => {
    setSelectedSlot(slot);
    setStatusMsg(null);
    setErrorMsg(null);
    void loadSlot(slot);
  };

  useEffect(() => {
    try {
      sessionStorage.setItem(SLOT_KEY, selectedSlot);
    } catch {
      /* ignore */
    }
  }, [selectedSlot]);

  useEffect(() => {
    if (!planContextReady) return;
    void loadSlot(selectedSlot, { silent: true });
  }, [anchor, selectedSlot, loadSlot, planContextReady]);

  useEffect(() => {
    if (!previewProposal || slotLoading || !planContextReady) {
      setShowPreview(false);
      return;
    }
    let cancelled = false;
    const reveal = () => {
      if (!cancelled) setShowPreview(true);
    };
    let deferId: number;
    if (typeof window.requestIdleCallback === "function") {
      deferId = window.requestIdleCallback(reveal, { timeout: 150 });
    } else {
      deferId = window.setTimeout(reveal, 0);
    }
    return () => {
      cancelled = true;
      if (typeof window.requestIdleCallback === "function") {
        window.cancelIdleCallback(deferId);
      } else {
        window.clearTimeout(deferId);
      }
    };
  }, [previewProposal, slotLoading, planContextReady, anchor]);

  const buildParams = (): PlanGenerateParams => {
    const trials = Math.max(1, Math.floor(simTrials));
    const seedTrim = seed.trim();
    if (trials > 1 && !seedTrim) {
      throw new Error("Seed is required when sim trials > 1");
    }
    const body: PlanGenerateParams = {
      anchor_date: anchor,
      days: Math.max(1, days),
      slot: selectedSlot,
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
    if (debugDayOffset > 0) {
      body.debug_day_offset = debugDayOffset;
    }
    return body;
  };

  const generateM = useMutation({
    mutationFn: () => generatePlan(buildParams()),
    onSuccess: (data) => {
      const p = data.proposal ?? planDocFromGenerate(data);
      setProposal(p);
      setDirty(false);
      setErrorMsg(null);
      setStatusMsg(`Generated proposal ${selectedSlot} (${p.assignments.length} assignments).`);
      void qc.invalidateQueries({ queryKey: ["plan", "proposals", anchor, debugDayOffset] });
    },
    onError: (e) => {
      let msg = e instanceof Error ? e.message : "Generate failed";
      try {
        const parsed = JSON.parse(msg) as { error?: string };
        if (parsed.error) msg = parsed.error;
      } catch {
        /* keep */
      }
      setErrorMsg(msg);
    },
  });

  const saveM = useMutation({
    mutationFn: async () => {
      if (!proposal) throw new Error("Nothing to save");
      return saveProposal(anchor, selectedSlot, proposal, cfgVersion, requestDebugOffset);
    },
    onSuccess: () => {
      setDirty(false);
      setStatusMsg(`Saved proposal ${selectedSlot}.`);
      void qc.invalidateQueries({ queryKey: ["plan", "proposals", anchor, debugDayOffset] });
      void loadSlot(selectedSlot);
    },
    onError: (e) => setErrorMsg(e instanceof Error ? e.message : "Save failed"),
  });

  const clearM = useMutation({
    mutationFn: () => clearProposal(anchor, selectedSlot, requestDebugOffset),
    onSuccess: () => {
      setProposal(null);
      setCfgVersion(0);
      setDirty(false);
      setStatusMsg(`Cleared proposal ${selectedSlot}.`);
      void qc.invalidateQueries({ queryKey: ["plan", "proposals", anchor, debugDayOffset] });
    },
    onError: (e) => setErrorMsg(e instanceof Error ? e.message : "Clear failed"),
  });

  const applyM = useMutation({
    mutationFn: () => applyPlan(anchor, selectedSlot, requestDebugOffset),
    onSuccess: (data) => {
      setProposal(null);
      setCfgVersion(0);
      setDirty(false);
      setStatusMsg(
        `Applied proposal ${selectedSlot} to verified schedule (${data.dates_written.length} day(s): ${data.dates_written.join(", ")}). All proposals cleared.`
      );
      void qc.invalidateQueries({ queryKey: ["plan", "proposals", anchor, debugDayOffset] });
    },
    onError: (e) => {
      const raw = e instanceof Error ? e.message : "Apply failed";
      try {
        const body = JSON.parse(raw) as { conflicting_dates?: string[] };
        if (body.conflicting_dates?.length) {
          setErrorMsg(
            `Cannot apply: verified schedule already exists for ${body.conflicting_dates.join(", ")}. Delete those days first (admin).`
          );
          return;
        }
      } catch {
        /* not JSON */
      }
      setErrorMsg(raw);
    },
  });

  const onProposalChange = (next: PlanDoc) => {
    setProposal(next);
    setDirty(true);
  };

  const handleGenerate = () => {
    if (slotFilled && proposal) {
      const ok = window.confirm(
        `Proposal ${selectedSlot} already has ${proposal.assignments.length} assignments.\n\nReplace it with a new simulation?`
      );
      if (!ok) return;
    }
    generateM.mutate();
  };

  const handleClear = () => {
    if (!slotFilled) return;
    const ok = window.confirm(
      `Clear proposal ${selectedSlot} for anchor ${anchor}?\n\nThis deletes the stored draft only (not the verified schedule).`
    );
    if (!ok) return;
    clearM.mutate();
  };

  const handleApply = () => {
    if (!proposal) return;
    const msg = [
      `Apply proposal ${selectedSlot} to the verified schedule?`,
      "",
      `Anchor date: ${proposal.anchor_date}`,
      `Planning days: ${proposal.days}`,
      `Assignments: ${proposal.assignments.length}`,
      `Shift hours: ${proposal.shift_hours}`,
      "",
      "This writes one verified day per planning date (fails if any date already exists). Deletes ALL proposal drafts (01–04).",
    ].join("\n");
    if (!window.confirm(msg)) return;
    applyM.mutate();
  };

  const copyResult = async () => {
    if (!proposal) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(proposal, null, 2));
    } catch {
      /* ignore */
    }
  };

  const handleDownloadPdf = async () => {
    if (!proposal || !zonesDoc) return;
    setPdfExporting(true);
    setErrorMsg(null);
    try {
      await downloadPlanReportPdf({
        proposal,
        slot: selectedSlot,
        zones: zonesDoc,
        soldierIds,
        soldiers,
        platoonColors,
        effectiveToday: planCtx?.effective_today,
      });
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "PDF export failed");
    } finally {
      setPdfExporting(false);
    }
  };

  const handleDownloadExcel = () => {
    if (!proposal || !zonesDoc) return;
    try {
      downloadPlanMatrixXls(
        {
          plan: proposal,
          zones: zonesDoc,
          soldierIds,
          soldiers,
          platoonColors,
        },
        planMatrixXlsFilenameForProposal(proposal.anchor_date, selectedSlot),
      );
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Excel export failed");
    }
  };

  const planCtx = planCtxQ.data;
  const applySummary = previewProposal
    ? `Proposal ${selectedSlot} · ${previewProposal.anchor_date} · ${previewProposal.days} day(s) · ${previewProposal.assignments.length} assignments`
    : slotFilled
      ? `Proposal ${selectedSlot} · empty or loading`
      : `Proposal ${selectedSlot} · empty — generate to create`;

  return (
    <div className="run-schedule-layout">
      <section className="glass-card run-form-card">
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "0.5rem",
            padding: "0.85rem 1.1rem 0.25rem",
          }}
        >
          <h2 className="contacts-title" style={{ margin: 0 }}>
            Plan schedule
          </h2>
          {onOpenHelp ? (
            <button
              type="button"
              className="btn btn-tinted help-plan-link"
              onClick={() => onOpenHelp("plan-workflow")}
              title="Open Help: Plan workflow"
            >
              ?
            </button>
          ) : null}
        </div>
        <p className="contacts-hint" style={{ margin: "0 0 0.75rem", padding: "0 1.1rem" }}>
          Up to four draft proposals for the next planning day. Pick a slot, generate or edit, save, then apply one
          to the verified schedule.
        </p>

        {planCtx && (
          <p className="contacts-hint" style={{ margin: "0 0 0.75rem", padding: "0 1.1rem" }}>
            Today (effective): <strong>{planCtx.effective_today}</strong> · planning anchor:{" "}
            <strong>{planCtx.plan_anchor}</strong>
          </p>
        )}

        <div className="plan-workflow-panel">
          <div className="plan-slot-picker">
            <span className="run-field-label title">1. Choose proposal</span>
            <div className="plan-slot-row">
              {(["01", "02", "03", "04"] as const).map((slot) => {
                const info = proposalsQ.data?.slots.find((s) => s.slot === slot);
                const filled = info?.exists;
                return (
                  <button
                    key={slot}
                    type="button"
                    className={`tab-pill plan-slot-pill${selectedSlot === slot ? " active" : ""}${filled ? " filled" : ""}`}
                    onClick={() => selectSlot(slot)}
                  >
                    {slot}
                    {filled ? ` · ${info?.assignment_count ?? 0}` : " · empty"}
                  </button>
                );
              })}
            </div>
            <AvailabilityBadges
              soldiersByDay={availabilityByDay}
              label="Availability (preview)"
              planDayStartLabel={planCtxQ.data?.plan_day_start ?? "05:00"}
            />
          </div>

          <div className="plan-active-banner" role="status">
            <strong>Editing:</strong> {applySummary}
            {dirty ? <span className="plan-unsaved-badge">unsaved edits</span> : proposal ? <span className="plan-saved-badge">saved</span> : null}
          </div>

          {!readOnly ? (
            <>
              <div className="plan-actions-group">
                <span className="run-field-label title">2. Proposal actions</span>
                <div className="plan-actions-row">
                  <button
                    type="button"
                    className="btn btn-filled"
                    disabled={generateM.isPending || !planContextReady}
                    onClick={handleGenerate}
                  >
                    {generateM.isPending ? "Generating…" : slotFilled ? "Regenerate" : "Generate new"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-tinted"
                    disabled={!proposal || saveM.isPending}
                    onClick={() => saveM.mutate()}
                  >
                    {saveM.isPending ? "Saving…" : "Save proposal"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-tinted"
                    disabled={!slotFilled || clearM.isPending}
                    onClick={handleClear}
                  >
                    {clearM.isPending ? "Clearing…" : "Clear proposal"}
                  </button>
                </div>
                <p className="contacts-hint plan-action-hint">
                  <strong>Generate</strong> runs the simulator into the selected slot. <strong>Save</strong> stores
                  edits (swaps below). <strong>Clear</strong> removes this slot only.
                </p>
              </div>

              <div className="plan-actions-group plan-apply-group">
                <span className="run-field-label title">3. Publish to verified schedule</span>
                <button
                  type="button"
                  className="btn btn-filled plan-apply-btn"
                  disabled={!proposal || applyM.isPending}
                  onClick={handleApply}
                >
                  {applyM.isPending
                    ? "Applying…"
                    : `Apply proposal ${selectedSlot} to verified schedule`}
                </button>
                <p className="contacts-hint plan-action-hint">
                  Applies <strong>proposal {selectedSlot}</strong> for anchor <strong>{anchor || "…"}</strong> only.
                  Confirms before writing; clears all four proposal slots afterward.
                </p>
              </div>
            </>
          ) : (
            <p className="contacts-hint plan-action-hint">Read-only: you can view proposals and stats but cannot generate, save, or apply.</p>
          )}
        </div>

        <details className="plan-sim-details">
          <summary>Simulation settings</summary>
          <div className="run-form-grid">
            {planCtx?.allow_debug_offset && (
              <Field label="Debug: days forward" hint="testing only">
                <input
                  className="settings-input"
                  type="number"
                  min={0}
                  max={366}
                  value={debugDayOffset}
                  onChange={(e) =>
                    setDebugDayOffset(Math.max(0, Math.floor(Number(e.target.value) || 0)))
                  }
                />
              </Field>
            )}

            <Field label="Days" hint="planning horizon">
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

            <Field label="Min consecutive free hours">
              <input
                className="settings-input"
                type="number"
                min={0}
                step={0.5}
                value={minFreeHours}
                onChange={(e) => setMinFreeHours(Number(e.target.value))}
              />
            </Field>

            <Field label="Min free shifts after duty">
              <input
                className="settings-input"
                type="number"
                min={0}
                value={minFreeShifts}
                onChange={(e) => setMinFreeShifts(Number(e.target.value))}
              />
            </Field>

            <Field label="Band relative">
              <input
                className="settings-input"
                type="number"
                min={0}
                step={0.05}
                value={bandRelative}
                onChange={(e) => setBandRelative(Number(e.target.value))}
              />
            </Field>

            <Field label="Sim trials">
              <input
                className="settings-input"
                type="number"
                min={1}
                value={simTrials}
                onChange={(e) => setSimTrials(Number(e.target.value))}
              />
            </Field>

            <Field label="Seed" hint="required if trials > 1">
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
        </details>

        {planCtxQ.isError && (
          <p className="msg-err plan-status-msg">
            Failed to load planning context: {planCtxQ.error instanceof Error ? planCtxQ.error.message : "Unknown error"}
          </p>
        )}
        {statusMsg && (
          <p className="contacts-hint plan-status-msg">{statusMsg}</p>
        )}
        {errorMsg && <p className="msg-err plan-status-msg">{errorMsg}</p>}
      </section>

      <section
        className={`run-results-panel${previewProposal ? " has-data" : ""}`}
        aria-label="Plan results"
      >
        <header className="run-results-header">
          <h3>Preview · proposal {selectedSlot}</h3>
          {previewProposal && (
            <span className="run-results-meta">
              {previewProposal.assignments.length} assignments
            </span>
          )}
          <div className="run-results-header-actions">
            <button
              type="button"
              className="btn btn-tinted"
              disabled={!proposal || !zonesDoc || pdfExporting}
              onClick={() => void handleDownloadPdf()}
              title="Download full proposal report as PDF"
            >
              <Download size={16} />
              {pdfExporting ? "Exporting…" : "Download PDF"}
            </button>
            <button
              type="button"
              className="btn btn-tinted"
              disabled={!proposal || !zonesDoc}
              onClick={handleDownloadExcel}
              title="Download schedule matrix (full names, platoon colors) as Excel"
            >
              <Download size={16} />
              Download Excel
            </button>
            <button
              type="button"
              className="btn btn-tinted"
              disabled={!proposal}
              onClick={() => void copyResult()}
              aria-label="Copy JSON"
            >
              <Copy size={16} />
              Copy
            </button>
          </div>
        </header>
        <div className="run-results-body">
          {(planCtxQ.isFetching && !planContextReady) || slotLoading ? (
            <p className="contacts-empty">
              {planCtxQ.isFetching && !planContextReady
                ? `Updating planning context${debugDayOffset > 0 ? ` (+${debugDayOffset}d)` : ""}…`
                : "Loading proposal…"}
            </p>
          ) : null}
          {planContextReady && !slotLoading && !previewProposal && (
            <p className="contacts-empty">
              Select a slot and click <strong>Generate new</strong> to preview the matrix and stats.
            </p>
          )}
          {previewProposal && planContextReady && !slotLoading && !showPreview && (
            <p className="contacts-empty">Loading preview…</p>
          )}
          {previewProposal && planContextReady && !slotLoading && zonesLoading && (
            <p className="contacts-empty">Loading zones configuration…</p>
          )}
          {previewProposal && planContextReady && !slotLoading && !zonesLoading && zonesLoadError && (
            <p className="msg-err">Cannot render schedule tables: {zonesLoadError}</p>
          )}
          {showPreview &&
            previewProposal &&
            planContextReady &&
            !slotLoading &&
            !zonesLoading &&
            zonesDoc && (
              <PlanDocView
                plan={previewProposal}
                zones={zonesDoc}
                soldierIds={soldierIds}
                soldiers={soldiers}
                platoonColors={platoonColors}
                sections={PLAN_TAB_PREVIEW_SECTIONS}
                onPlanChange={readOnly ? undefined : onProposalChange}
                readOnly={readOnly}
                soldiersByDay={previewAvailQ.data}
              />
            )}
        </div>
      </section>
    </div>
  );
}

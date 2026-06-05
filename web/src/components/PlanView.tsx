import { Check, Copy, Download, FileText, HelpCircle, Play, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, apiGet, apiPut } from "../api";
import {
  applyPlan,
  clearProposal,
  fetchPlanContext,
  generatePlan,
  getProposal,
  listProposals,
  saveProposal,
  type ExpertRulesCfg,
  type PlanGenerateParams,
  type PlanDoc,
} from "../api/plan";
import { useZonesDocument } from "../context/ZonesDocumentContext";
import { parsePlatoonColorsFromGlobal } from "../lib/platoonColors";
import { planDocFromGenerate } from "../lib/planDoc";
import { ALLOWED_SHIFT_HOURS, validateShiftHours } from "../lib/zones";
import { downloadPlanMatrixXls, planMatrixXlsFilenameForProposal } from "../lib/planMatrixExport";
import { downloadPlanReportPdf } from "../lib/planPdfExport";
import { EXPERT_RULES_EXAMPLE_TEXT } from "../lib/expertRulesExamples";
import { useDevPanel } from "../context/AppStateContext";
import { parseApiError, type ParsedApiError } from "../lib/apiError";
import { DevPanelTrigger, DeveloperPanel } from "./DeveloperPanel";
import { PlanDocView } from "./PlanDocView";
import { PlanErrorPanel } from "./PlanErrorPanel";
import { PlanTabErrorBoundary } from "./PlanTabErrorBoundary";
import {
  AvailabilityBadges,
  fetchPreviewAvailabilityByDays,
  type PlanDaySoldiers,
} from "./SoldiersStatusBoard";
import { soldiersFromCfg, type ScheduleReportSections } from "./ScheduleResultsReport";

const SLOT_KEY = "guard-plan-slot";

/** Plan tab: matrix (ids + full names) + stats + duty-only timelines. */
const PLAN_TAB_PREVIEW_SECTIONS: ScheduleReportSections = {
  matrixShort: true,
  matrixFull: true,
  bySoldier: false,
  timeline: true,
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
  openExpertRulesAccordion = false,
  onExpertRulesAccordionOpened,
}: {
  readOnly?: boolean;
  onOpenHelp?: (sectionId?: string) => void;
  openExpertRulesAccordion?: boolean;
  onExpertRulesAccordionOpened?: () => void;
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
  const cfgVersionRef = useRef(0);
  const syncCfgVersion = useCallback((version: number) => {
    cfgVersionRef.current = version;
    setCfgVersion(version);
  }, []);
  const [dirty, setDirty] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [planError, setPlanError] = useState<ParsedApiError | null>(null);
  const [errorAction, setErrorAction] = useState<"generate" | "apply" | "save" | "clear" | "load" | null>(
    null
  );
  const [lastGenerateParams, setLastGenerateParams] = useState<PlanGenerateParams | null>(null);
  const { openPanel } = useDevPanel();
  const [pdfExporting, setPdfExporting] = useState(false);
  const [slotLoading, setSlotLoading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [expertRulesText, setExpertRulesText] = useState("");
  const [expertForce, setExpertForce] = useState(false);
  const [expertGroups, setExpertGroups] = useState<Record<string, string>>({});
  const [expertRulesVersion, setExpertRulesVersion] = useState(0);
  const [newGroupName, setNewGroupName] = useState("");
  const [appendGroupSelect, setAppendGroupSelect] = useState("");
  const [expertRulesOpen, setExpertRulesOpen] = useState(false);
  const expertRulesHydratedRef = useRef(false);
  const [expertParseError, setExpertParseError] = useState<string | null>(null);
  const [ruleConflicts, setRuleConflicts] = useState<
    { day: number; slot: number; shift: number; soldier_id: string; reason: string }[]
  >([]);

  const requestDebugOffset = debugDayOffset > 0 ? debugDayOffset : undefined;

  const setPlanFailure = useCallback(
    (action: typeof errorAction, err: unknown) => {
      setPlanError(parseApiError(err));
      setErrorAction(action);
      openPanel("response");
    },
    [openPanel]
  );

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

  const expertRulesQ = useQuery({
    queryKey: ["cfg", "expert_rules"],
    queryFn: () =>
      apiGet<{ value: ExpertRulesCfg; version: number }>("/api/cfg/expert_rules").catch(() => ({
        value: {},
        version: 0,
      })),
  });

  useEffect(() => {
    if (expertRulesHydratedRef.current || !expertRulesQ.data) return;
    expertRulesHydratedRef.current = true;
    const v = expertRulesQ.data.value as ExpertRulesCfg | undefined;
    if (!v) return;
    if (typeof v.rules_text === "string") setExpertRulesText(v.rules_text);
    if (typeof v.force === "boolean") setExpertForce(v.force);
    if (v.groups && typeof v.groups === "object") setExpertGroups(v.groups);
    if (typeof expertRulesQ.data.version === "number") {
      setExpertRulesVersion(expertRulesQ.data.version);
    }
  }, [expertRulesQ.data]);

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
      if (!opts?.silent) setPlanError(null);
      setSlotLoading(true);
      try {
        const data = await getProposal(anchor, slot, requestDebugOffset);
        if (seq !== loadSeqRef.current) return;
        setProposal(data.proposal);
        syncCfgVersion(data.version);
        setDirty(false);
      } catch (e) {
        if (seq !== loadSeqRef.current) return;
        setProposal(null);
        syncCfgVersion(0);
        setDirty(false);
        if (!opts?.silent && !(e instanceof ApiError && e.status === 404)) {
          setPlanFailure("load", e);
        }
      } finally {
        if (seq === loadSeqRef.current) setSlotLoading(false);
      }
    },
    [anchor, requestDebugOffset, setPlanFailure, syncCfgVersion]
  );

  const selectSlot = (slot: string) => {
    setSelectedSlot(slot);
    setStatusMsg(null);
    setPlanError(null);
    setErrorAction(null);
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
    if (!openExpertRulesAccordion) return;
    setExpertRulesOpen(true);
    onExpertRulesAccordionOpened?.();
  }, [openExpertRulesAccordion, onExpertRulesAccordionOpened]);

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
    const rulesTrim = expertRulesText.trim();
    if (rulesTrim) {
      body.rules_text = rulesTrim;
    }
    if (expertForce) {
      body.force = true;
    }
    return body;
  };

  const persistExpertRulesCfg = async (groups: Record<string, string>, rulesText: string) => {
    const value: ExpertRulesCfg = {
      schema_version: 1,
      force: expertForce,
      rules_text: rulesText,
      groups,
    };
    const res = (await apiPut("/api/cfg/expert_rules", {
      value,
      expected_version: expertRulesVersion,
    })) as { version?: number };
    if (typeof res.version === "number") {
      setExpertRulesVersion(res.version);
    }
    void qc.invalidateQueries({ queryKey: ["cfg", "expert_rules"] });
  };

  const appendExpertGroup = () => {
    const name = appendGroupSelect.trim();
    const chunk = expertGroups[name]?.trim();
    if (!name || !chunk) return;
    setExpertRulesText((prev) => {
      const p = prev.trim();
      return p ? `${p}\n${chunk}` : chunk;
    });
    setExpertParseError(null);
  };

  const saveExpertAsGroup = async () => {
    const name = newGroupName.trim();
    if (!name) return;
    const nextGroups = { ...expertGroups, [name]: expertRulesText };
    setExpertGroups(nextGroups);
    setAppendGroupSelect(name);
    setNewGroupName("");
    try {
      await persistExpertRulesCfg(nextGroups, expertRulesText);
      setStatusMsg(`Saved rule group “${name}”.`);
    } catch (e) {
      setPlanFailure("save", e);
    }
  };

  const removeExpertGroup = async () => {
    const name = appendGroupSelect.trim();
    if (!name || !expertGroups[name]) return;
    if (!window.confirm(`Delete saved group “${name}”?`)) return;
    const nextGroups = { ...expertGroups };
    delete nextGroups[name];
    setExpertGroups(nextGroups);
    setAppendGroupSelect("");
    try {
      await persistExpertRulesCfg(nextGroups, expertRulesText);
      setStatusMsg(`Deleted group “${name}”.`);
    } catch (e) {
      setPlanFailure("save", e);
    }
  };

  const insertExpertExamples = () => {
    const chunk = EXPERT_RULES_EXAMPLE_TEXT.trim();
    setExpertRulesText((prev) => {
      const p = prev.trim();
      return p ? `${p}\n\n${chunk}` : chunk;
    });
    setExpertParseError(null);
  };

  const generateM = useMutation({
    mutationFn: (params: PlanGenerateParams) => generatePlan(params),
    onMutate: () => {
      loadSeqRef.current += 1;
    },
    onSuccess: (data) => {
      const p = data.proposal ?? planDocFromGenerate(data);
      setProposal(p);
      setDirty(false);
      setPlanError(null);
      setErrorAction(null);
      setExpertParseError(null);
      const raw = p.meta?.rule_conflicts;
      if (Array.isArray(raw)) {
        setRuleConflicts(
          raw.filter(
            (c): c is { day: number; slot: number; shift: number; soldier_id: string; reason: string } =>
              c != null && typeof c === "object"
          ) as { day: number; slot: number; shift: number; soldier_id: string; reason: string }[]
        );
      } else {
        setRuleConflicts([]);
      }
      if (typeof data.version === "number") {
        syncCfgVersion(data.version);
      } else {
        void loadSlot(selectedSlot, { silent: true });
      }
      setStatusMsg(() => {
        let msg = `Generated proposal ${selectedSlot} (${p.assignments.length} assignments).`;
        const applied = p.meta?.custom_rules_applied;
        if (typeof applied === "number" && applied > 0) {
          msg += ` Expert rules applied: ${applied}.`;
        } else if (expertRulesText.trim()) {
          msg += " Expert rules sent; none matched a seat (check day/slot/shift).";
        }
        if (expertRulesText.includes("force:") && !expertForce) {
          msg += " Force prefer: enable Force if the named soldier did not appear.";
        }
        return msg;
      });
      void qc.invalidateQueries({ queryKey: ["plan", "proposals", anchor, debugDayOffset] });
    },
    onError: (e) => {
      const parsed = parseApiError(e);
      if (parsed.code === "validation" && parsed.message.toLowerCase().includes("expert rules")) {
        setExpertParseError(parsed.message);
      }
      setPlanFailure("generate", e);
    },
  });

  const saveM = useMutation({
    mutationFn: async () => {
      if (!proposal) throw new Error("Nothing to save");
      return saveProposal(anchor, selectedSlot, proposal, cfgVersionRef.current, requestDebugOffset);
    },
    onMutate: () => {
      loadSeqRef.current += 1;
    },
    onSuccess: (res) => {
      if (typeof res.version === "number") {
        syncCfgVersion(res.version);
      }
      setDirty(false);
      setPlanError(null);
      setErrorAction(null);
      setStatusMsg(`Saved proposal ${selectedSlot}.`);
      void qc.invalidateQueries({ queryKey: ["plan", "proposals", anchor, debugDayOffset] });
      void loadSlot(selectedSlot, { silent: true });
    },
    onError: (e) => setPlanFailure("save", e),
  });

  const clearM = useMutation({
    mutationFn: () => clearProposal(anchor, selectedSlot, requestDebugOffset),
    onSuccess: () => {
      setProposal(null);
      syncCfgVersion(0);
      setDirty(false);
      setPlanError(null);
      setErrorAction(null);
      setStatusMsg(`Cleared proposal ${selectedSlot}.`);
      void qc.invalidateQueries({ queryKey: ["plan", "proposals", anchor, debugDayOffset] });
    },
    onError: (e) => setPlanFailure("clear", e),
  });

  const applyM = useMutation({
    mutationFn: () => applyPlan(anchor, selectedSlot, requestDebugOffset),
    onSuccess: (data) => {
      setProposal(null);
      syncCfgVersion(0);
      setDirty(false);
      setPlanError(null);
      setErrorAction(null);
      setStatusMsg(
        `Applied proposal ${selectedSlot} to verified schedule (${data.dates_written.length} day(s): ${data.dates_written.join(", ")}). All proposals cleared.`
      );
      void qc.invalidateQueries({ queryKey: ["plan", "proposals", anchor, debugDayOffset] });
    },
    onError: (e) => setPlanFailure("apply", e),
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
    try {
      const params = buildParams();
      setLastGenerateParams(params);
      setPlanError(null);
      setErrorAction(null);
      generateM.mutate(params);
    } catch (e) {
      setPlanFailure("generate", e);
    }
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
    setPlanError(null);
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
      setPlanError(parseApiError(e));
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
      setPlanError(parseApiError(e));
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
                    className="btn btn-filled btn-compact"
                    disabled={generateM.isPending || !planContextReady}
                    onClick={handleGenerate}
                    title="Run simulator into selected proposal slot"
                  >
                    {generateM.isPending ? (
                      "…"
                    ) : slotFilled ? (
                      <>
                        <RefreshCw size={16} aria-hidden />
                        <span className="sr-only">Generate</span>
                      </>
                    ) : (
                      <>
                        <Play size={16} aria-hidden />
                        <span className="sr-only">Generate</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    className="btn btn-tinted btn-compact"
                    disabled={!proposal || saveM.isPending}
                    onClick={() => saveM.mutate()}
                    title="Persist draft and manual swaps"
                  >
                    <Save size={16} aria-hidden />
                    <span className="sr-only">{saveM.isPending ? "Saving" : "Save"}</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-tinted btn-compact"
                    disabled={!slotFilled || clearM.isPending}
                    onClick={handleClear}
                    title="Delete this proposal slot only"
                  >
                    <Trash2 size={16} aria-hidden />
                    <span className="sr-only">{clearM.isPending ? "Clearing" : "Clear"}</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-filled btn-compact"
                    disabled={!proposal || applyM.isPending}
                    onClick={handleApply}
                    title={`Apply proposal ${selectedSlot} to verified schedule (clears all four slots)`}
                  >
                    <Check size={16} aria-hidden />
                    <span className="sr-only">{applyM.isPending ? "Applying" : "Apply"}</span>
                  </button>
                </div>
              </div>

              <details
                className="plan-sim-details plan-expert-details"
                open={expertRulesOpen}
                onToggle={(e) => setExpertRulesOpen(e.currentTarget.open)}
              >
                <summary>Expert rules</summary>
                <div className="plan-expert-body">
                  <details className="plan-expert-help" open>
                    <summary>How to use</summary>
                    <div className="plan-expert-hint-row">
                      <p className="contacts-hint plan-expert-hint-text">
                        One line per rule. Copy <code>day</code>, <code>slot</code>, <code>shift</code> from matrix
                        tooltips.
                      </p>
                      {onOpenHelp ? (
                        <button
                          type="button"
                          className="btn btn-tinted help-plan-link plan-expert-help-btn"
                          onClick={() => onOpenHelp("expert-rules")}
                          title="Open Help: Expert rules"
                        >
                          <HelpCircle size={18} aria-hidden />
                          <span className="sr-only">Expert rules guide</span>
                        </button>
                      ) : null}
                    </div>
                  </details>
                  {Object.keys(expertGroups).length > 0 ? (
                    <div className="plan-expert-group-row">
                      <select
                        className="settings-input settings-input-wide plan-expert-ltr-input"
                        value={appendGroupSelect}
                        onChange={(e) => setAppendGroupSelect(e.target.value)}
                      >
                        <option value="">Saved group…</option>
                        {Object.keys(expertGroups).sort().map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn btn-tinted btn-compact"
                        disabled={!appendGroupSelect}
                        onClick={appendExpertGroup}
                        title="Append selected group to editor"
                      >
                        <Plus size={16} aria-hidden />
                        <span className="sr-only">Append group</span>
                      </button>
                      <button
                        type="button"
                        className="btn btn-tinted btn-compact"
                        disabled={!appendGroupSelect}
                        onClick={() => void removeExpertGroup()}
                        title="Delete selected saved group"
                      >
                        <Trash2 size={16} aria-hidden />
                        <span className="sr-only">Delete group</span>
                      </button>
                    </div>
                  ) : null}
                  <div className="plan-expert-editor-wrap">
                    <div className="plan-expert-editor-toolbar">
                      <button
                        type="button"
                        className="btn btn-tinted btn-compact"
                        onClick={insertExpertExamples}
                        title="Insert all help examples into editor (appended)"
                      >
                        <FileText size={16} aria-hidden />
                        <span className="sr-only">Add examples</span>
                      </button>
                    </div>
                    <textarea
                      className="settings-input plan-expert-rules-text"
                      dir="ltr"
                      value={expertRulesText}
                      onChange={(e) => {
                        setExpertRulesText(e.target.value);
                        setExpertParseError(null);
                      }}
                      placeholder={"day:0 slot:1 shift:0 not:s1\nslot:8 pin:3"}
                      spellCheck={false}
                    />
                  </div>
                  <div className="plan-expert-group-row">
                    <input
                      className="settings-input plan-expert-ltr-input plan-expert-group-name"
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      placeholder="Group name"
                    />
                    <button
                      type="button"
                      className="btn btn-tinted btn-compact"
                      disabled={!newGroupName.trim()}
                      onClick={() => void saveExpertAsGroup()}
                      title="Save editor text as group (overwrites same name)"
                    >
                      <Save size={16} aria-hidden />
                      <span className="sr-only">Save group</span>
                    </button>
                  </div>
                  <label className="plan-expert-force contacts-hint">
                    <input
                      type="checkbox"
                      checked={expertForce}
                      onChange={(e) => setExpertForce(e.target.checked)}
                    />
                    <span>
                      <strong>Force</strong> — assign forced soldiers even when rest/availability blocks them
                    </span>
                  </label>
                  {expertParseError ? (
                    <p className="contacts-hint plan-expert-error">{expertParseError}</p>
                  ) : null}
                </div>
              </details>
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
          <PlanErrorPanel
            error={parseApiError(planCtxQ.error)}
            title="Could not load planning context"
          />
        )}
        {ruleConflicts.length > 0 ? (
          <div className="plan-status-msg" style={{ padding: "0 1.1rem 0.75rem" }}>
            <p className="contacts-hint" style={{ margin: "0 0 0.35rem" }}>
              <strong>Rule conflicts</strong> ({ruleConflicts.length}) — hard force overrides:
            </p>
            <ul className="contacts-hint" style={{ margin: 0, paddingLeft: "1.25rem" }}>
              {ruleConflicts.map((c, i) => (
                <li key={i}>
                  day:{c.day} slot:{c.slot + 1} shift:{c.shift} {c.soldier_id} — {c.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {statusMsg && (
          <p className="contacts-hint plan-status-msg">{statusMsg}</p>
        )}
        {planError && (
          <PlanErrorPanel
            error={planError}
            clientRequest={lastGenerateParams ?? undefined}
            title={
              errorAction === "generate"
                ? "Generate failed"
                : errorAction === "apply"
                  ? "Apply failed"
                  : "Plan action failed"
            }
            defaultOpenTechnical={errorAction === "generate"}
          />
        )}
      </section>

      <section
        className={`run-results-panel${previewProposal || planError ? " has-data" : ""}`}
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
          {planError && (
            <>
              <PlanErrorPanel
                error={planError}
                clientRequest={lastGenerateParams ?? undefined}
                title={
                  errorAction === "apply"
                    ? "Apply failed"
                    : errorAction === "generate"
                      ? "Generate failed"
                      : "Plan action failed"
                }
                defaultOpenTechnical={errorAction === "generate"}
              />
              {errorAction === "save" && planError.code === "version_conflict" ? (
                <div className="plan-actions-row" style={{ marginTop: "0.75rem" }}>
                  <button
                    type="button"
                    className="btn btn-tinted"
                    disabled={slotLoading}
                    onClick={() => {
                      setPlanError(null);
                      setErrorAction(null);
                      void loadSlot(selectedSlot);
                    }}
                  >
                    {slotLoading ? "Reloading…" : "Reload slot and retry edits"}
                  </button>
                </div>
              ) : null}
            </>
          )}
          {(planCtxQ.isFetching && !planContextReady) || slotLoading ? (
            <p className="contacts-empty">
              {planCtxQ.isFetching && !planContextReady
                ? `Updating planning context${debugDayOffset > 0 ? ` (+${debugDayOffset}d)` : ""}…`
                : "Loading proposal…"}
            </p>
          ) : null}
          {planContextReady && !slotLoading && !previewProposal && !planError && (
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
              <PlanTabErrorBoundary onReset={() => setShowPreview(false)}>
                <PlanDocView
                  plan={previewProposal}
                  zones={zonesDoc}
                  soldierIds={soldierIds}
                  soldiers={soldiers}
                  platoonColors={platoonColors}
                  sections={PLAN_TAB_PREVIEW_SECTIONS}
                  onPlanChange={readOnly ? undefined : onProposalChange}
                  readOnly={readOnly}
                  soldiersByDay={availabilityByDay}
                />
              </PlanTabErrorBoundary>
            )}
        </div>
      </section>

      <DevPanelTrigger
        onOpen={() => openPanel(planError ? "response" : "logs")}
        aria-label={planError ? "Open developer panel (last API response)" : "Open developer panel"}
      />
      <DeveloperPanel
        jsonText={proposal ? JSON.stringify(proposal, null, 2) : "{}"}
        onJsonTextChange={() => {}}
        jsonError={null}
        onResetDefaults={() => {}}
      />
    </div>
  );
}

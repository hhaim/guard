import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPut } from "../api";
import { fetchPlanContext } from "../api/plan";
import { useDevPanel } from "../context/AppStateContext";
import {
  clampPlanDebugDayOffset,
  DEFAULT_GLOBAL,
  deriveJsonFromForm,
  formFromServerValue,
  MAX_PLAN_DEBUG_DAY_OFFSET,
  parseFormFromJson,
  type GlobalFormData,
} from "../lib/globalConfig";
import { parsePlanDayStart } from "../lib/planDay";
import { DevPanelTrigger, DeveloperPanel } from "./DeveloperPanel";

type CfgResp = { key: string; value: unknown; version: number; updated_at: string };

function NumberField({
  label,
  hint,
  value,
  onChange,
  inputMode = "numeric",
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (n: number) => void;
  inputMode?: "numeric" | "decimal";
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-label">
        <span className="title">{label}</span>
        {hint && <span className="hint">{hint}</span>}
      </div>
      <input
        className="settings-input"
        type="text"
        inputMode={inputMode}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        value={String(value)}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.trunc(n));
        }}
      />
    </div>
  );
}

export function GlobalConfigView() {
  const qc = useQueryClient();
  const { openPanel } = useDevPanel();

  const globalQ = useQuery({
    queryKey: ["cfg", "global"],
    queryFn: () => apiGet<CfgResp>("/api/cfg/global"),
  });

  const [formData, setFormData] = useState<GlobalFormData>({ ...DEFAULT_GLOBAL });
  const [jsonOverride, setJsonOverride] = useState<string | null>(null);
  const [version, setVersion] = useState<number | undefined>();
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!globalQ.data) return;
    const next = formFromServerValue(globalQ.data.value);
    setFormData(next);
    setJsonOverride(null);
    setVersion(globalQ.data.version);
    setDirty(false);
  }, [globalQ.data]);

  const liveJson = useMemo(() => {
    if (jsonOverride != null) {
      try {
        return JSON.parse(jsonOverride) as Record<string, unknown>;
      } catch {
        return deriveJsonFromForm(formData);
      }
    }
    return deriveJsonFromForm(formData);
  }, [formData, jsonOverride]);

  const jsonError = useMemo(() => {
    if (jsonOverride == null) return null;
    try {
      JSON.parse(jsonOverride);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Invalid JSON";
    }
  }, [jsonOverride]);

  const editorText =
    jsonOverride ?? JSON.stringify(deriveJsonFromForm(formData), null, 2);

  const syncJsonToForm = useCallback((text: string) => {
    setJsonOverride(text);
    try {
      const parsed = JSON.parse(text) as unknown;
      setFormData(parseFormFromJson(parsed));
      setDirty(true);
    } catch {
      /* keep draft; error shown in panel */
    }
  }, []);

  const updateField = useCallback(<K extends keyof GlobalFormData>(key: K, value: GlobalFormData[K]) => {
    setJsonOverride(null);
    setFormData((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }, []);

  const resetDefaults = useCallback(() => {
    setJsonOverride(null);
    setFormData({ ...DEFAULT_GLOBAL });
    setDirty(true);
  }, []);

  const saveM = useMutation({
    mutationFn: async () => {
      if (jsonError) throw new Error(jsonError);
      await apiPut("/api/cfg/global", {
        value: liveJson,
        expected_version: version ?? 0,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cfg", "global"] });
      qc.invalidateQueries({ queryKey: ["plan", "context"] });
      setDirty(false);
      setJsonOverride(null);
    },
  });

  const previewOffset = clampPlanDebugDayOffset(formData.plan_debug_day_offset);
  const planPreviewQ = useQuery({
    queryKey: ["plan", "context", "preview", previewOffset, dirty],
    queryFn: () =>
      fetchPlanContext(dirty || previewOffset > 0 ? previewOffset : undefined),
  });
  const planPreview = planPreviewQ.data;

  const globalStatusLabel =
    saveM.isPending
      ? "Saving global…"
      : saveM.isSuccess && !dirty
        ? "Global saved"
        : saveM.isError
          ? "Global save failed"
          : dirty
            ? "Global pending save…"
            : "";

  const saveDisabled = saveM.isPending || !!jsonError || globalQ.isLoading || !dirty;

  return (
    <>
      <header className="contacts-toolbar">
        <div className="contacts-toolbar-text">
          <h2 className="contacts-title">Global</h2>
          <p className="contacts-count">
            Simulation, randomness, and plan-day settings
            {globalStatusLabel ? ` · ${globalStatusLabel}` : ""}
          </p>
        </div>
      </header>

      <div className="btn-row">
        <button
          type="button"
          className="btn btn-filled"
          disabled={saveDisabled}
          onPointerDown={(e) => {
            e.preventDefault();
            saveM.mutate();
          }}
        >
          <Save size={18} strokeWidth={2} />
          Save global
        </button>
        {dirty && (
          <button
            type="button"
            className="btn btn-plain"
            onPointerDown={(e) => {
              e.preventDefault();
              if (globalQ.data) {
                setFormData(formFromServerValue(globalQ.data.value));
                setJsonOverride(null);
                setDirty(false);
              }
            }}
          >
            Discard
          </button>
        )}
      </div>
      {(saveM.isError || jsonError) && (
        <p className="msg-err">{saveM.isError ? (saveM.error as Error).message : jsonError}</p>
      )}
      {saveM.isSuccess && !dirty && <p className="msg-ok">Global saved.</p>}

      <div className="global-form-grid">
        <section className="glass-card" aria-label="Simulation">
          <h2 className="settings-section-header">Simulation</h2>
          <NumberField
            label="History days"
            hint="Verified schedule days loaded before each plan (checkpoint extend)"
            value={formData.history_days}
            onChange={(n) => updateField("history_days", n)}
          />
          <NumberField
            label="Iterations"
            hint="Number of scheduling passes"
            value={formData.number_of_iteration}
            onChange={(n) => updateField("number_of_iteration", n)}
          />
          <div className="settings-row">
            <div className="settings-row-label">
              <span className="title">Plan day start</span>
              <span className="hint">Start of each 24h plan day (HH:00, UTC)</span>
            </div>
            <input
              className="settings-input"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={formData.plan_day_start}
              onChange={(e) => {
                const raw = e.target.value;
                const p = parsePlanDayStart(raw);
                updateField("plan_day_start", p.ok ? p.value : raw);
              }}
            />
          </div>
        </section>

        <section className="glass-card" aria-label="Randomness">
          <h2 className="settings-section-header">Randomness</h2>
          <NumberField
            label="Random seed"
            hint="Deterministic shuffle when set"
            value={formData.random_seed}
            onChange={(n) => updateField("random_seed", n)}
          />
        </section>

        <section className="glass-card" aria-label="Planning debug">
          <h2 className="settings-section-header">Planning (debug)</h2>
          <NumberField
            label="Days forward"
            hint={`Simulate effective today +N (0–${MAX_PLAN_DEBUG_DAY_OFFSET}). Testing only; save to apply.`}
            value={formData.plan_debug_day_offset}
            onChange={(n) => updateField("plan_debug_day_offset", clampPlanDebugDayOffset(n))}
          />
          {planPreview && (
            <p className="meta-line" style={{ marginTop: "0.75rem" }}>
              Effective today: <strong>{planPreview.effective_today}</strong> · plan anchor:{" "}
              <strong>{planPreview.plan_anchor}</strong>
              {previewOffset > 0 ? ` (+${previewOffset}d)` : null}
              {!dirty && previewOffset > 0 ? " · saved" : dirty ? " · preview (unsaved)" : null}
            </p>
          )}
        </section>
      </div>

      {globalQ.isLoading && <p className="meta-line">Loading configuration…</p>}
      {globalQ.isError && <p className="msg-err">{(globalQ.error as Error).message}</p>}
      {globalQ.data && (
        <p className="meta-line">
          Version {globalQ.data.version} · updated {new Date(globalQ.data.updated_at).toLocaleString()}
        </p>
      )}

      <DevPanelTrigger onOpen={() => openPanel("json")} />
      <DeveloperPanel
        jsonText={editorText}
        onJsonTextChange={syncJsonToForm}
        jsonError={jsonError}
        onResetDefaults={resetDefaults}
      />
    </>
  );
}

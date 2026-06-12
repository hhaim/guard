import { useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../api";
import { importSoldierStatus, listSoldierStatus } from "../api/soldierStatus";
import { formatApiError } from "../lib/apiError";
import { enumeratePlanDays, MAX_PLATOON_VACATION_DAYS } from "../lib/planDayRange";
import { planDayBoundsIso } from "../lib/planDayBounds";
import {
  buildPlatoonStatusImportPayloads,
  copyPlatoonStatusReport,
  formatPlatoonStatusReport,
  planPlatoonStatusChange,
  type PlatoonStatusUnchanged,
  type PlatoonTargetStatus,
} from "../lib/platoonVacation";
import type { PlanDaySoldiers } from "./SoldiersStatusBoard";
import { platoonLabel, type SoldierPlatoonsDoc } from "../lib/soldierPlatoons";
import type { Soldier } from "../lib/soldiers";

type Props = {
  open: boolean;
  rosterSoldiers: Soldier[];
  platoonsDoc: SoldierPlatoonsDoc;
  anchorDate: string;
  planDayStartHour: number;
  planDayStartLabel: string;
  onClose: () => void;
  onSaved: () => void;
};

const STATUS_OPTIONS: { value: PlatoonTargetStatus; label: string }[] = [
  { value: "on_base", label: "On base" },
  { value: "away", label: "Away" },
  { value: "sick", label: "Sick" },
  { value: "training", label: "Training" },
  { value: "other", label: "Other" },
];

function statusLabel(target: PlatoonTargetStatus): string {
  return STATUS_OPTIONS.find((o) => o.value === target)?.label ?? target;
}

export function PlatoonStatusSheet({
  open,
  rosterSoldiers,
  platoonsDoc,
  anchorDate,
  planDayStartHour,
  planDayStartLabel,
  onClose,
  onSaved,
}: Props) {
  const platoonOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of rosterSoldiers) {
      const c = s.platoon_code?.trim();
      if (!c) continue;
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([code, count]) => ({
        code,
        label: platoonLabel(platoonsDoc, code),
        count,
      }));
  }, [rosterSoldiers, platoonsDoc]);

  const [platoonCode, setPlatoonCode] = useState(platoonOptions[0]?.code ?? "");
  const [fromStatus, setFromStatus] = useState<PlatoonTargetStatus>("on_base");
  const [toStatus, setToStatus] = useState<PlatoonTargetStatus>("away");
  const [fromDate, setFromDate] = useState(anchorDate);
  const [toDate, setToDate] = useState(anchorDate);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const [lastReport, setLastReport] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<{
    updates: { soldier: Soldier; planDay: string }[];
    unchanged: PlatoonStatusUnchanged[];
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    setFromDate(anchorDate);
    setToDate(anchorDate);
    setError(null);
    setCopyHint(null);
    setLastReport(null);
    setPreview(null);
    if (platoonOptions.length > 0 && !platoonOptions.some((p) => p.code === platoonCode)) {
      setPlatoonCode(platoonOptions[0].code);
    }
  }, [open, anchorDate, platoonOptions, platoonCode]);

  const planDays = useMemo(() => {
    if (!fromDate || !toDate || fromDate > toDate) return [];
    return enumeratePlanDays(fromDate, toDate);
  }, [fromDate, toDate]);

  const rangeTooLong = planDays.length > MAX_PLATOON_VACATION_DAYS;

  useEffect(() => {
    if (!open || !platoonCode || planDays.length === 0 || rangeTooLong) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    void (async () => {
      try {
        const first = planDayBoundsIso(planDays[0], planDayStartHour);
        const last = planDayBoundsIso(planDays[planDays.length - 1], planDayStartHour);
        const [previewsByDay, statusEntries] = await Promise.all([
          (async () => {
            const out: Record<string, PlanDaySoldiers> = {};
            await Promise.all(
              planDays.map(async (d) => {
                out[d] = await apiGet<PlanDaySoldiers>(
                  `/api/plan/preview-availability?date=${encodeURIComponent(d)}`,
                );
              }),
            );
            return out;
          })(),
          listSoldierStatus(first.start, last.end),
        ]);
        if (cancelled) return;
        setPreview(
          planPlatoonStatusChange(
            rosterSoldiers,
            platoonCode,
            planDays,
            previewsByDay,
            statusEntries,
            fromStatus,
            toStatus,
            planDayStartHour,
          ),
        );
      } catch {
        if (!cancelled) setPreview(null);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, platoonCode, planDays, rangeTooLong, rosterSoldiers, fromStatus, toStatus, planDayStartHour]);

  const reportText = useMemo(() => {
    if (!preview || !platoonCode) return "";
    return formatPlatoonStatusReport({
      platoonCode,
      platoonLabel: platoonLabel(platoonsDoc, platoonCode),
      from: fromStatus,
      target: toStatus,
      fromDate,
      throughDate: toDate,
      updates: preview.updates,
      unchanged: preview.unchanged,
    });
  }, [preview, platoonCode, platoonsDoc, fromStatus, toStatus, fromDate, toDate]);

  const mutate = useMutation({
    mutationFn: async () => {
      setError(null);
      setLastReport(null);
      if (!platoonCode) throw new Error("Select a platoon");
      if (planDays.length === 0) throw new Error("Invalid date range");
      if (rangeTooLong) {
        throw new Error(`Range cannot exceed ${MAX_PLATOON_VACATION_DAYS} plan days`);
      }
      const first = planDayBoundsIso(planDays[0], planDayStartHour);
      const last = planDayBoundsIso(planDays[planDays.length - 1], planDayStartHour);
      const [previewsByDay, statusEntries] = await Promise.all([
        (async () => {
          const out: Record<string, PlanDaySoldiers> = {};
          await Promise.all(
            planDays.map(async (d) => {
              out[d] = await apiGet<PlanDaySoldiers>(
                `/api/plan/preview-availability?date=${encodeURIComponent(d)}`,
              );
            }),
          );
          return out;
        })(),
        listSoldierStatus(first.start, last.end),
      ]);
      const plan = planPlatoonStatusChange(
        rosterSoldiers,
        platoonCode,
        planDays,
        previewsByDay,
        statusEntries,
        fromStatus,
        toStatus,
        planDayStartHour,
      );
      if (plan.platoonMembers.length === 0) {
        throw new Error("No soldiers in this platoon on the roster");
      }
      if (plan.updates.length === 0) {
        throw new Error(
          `No soldiers are in “${statusLabel(fromStatus)}” on every plan day in this range — nothing to update`,
        );
      }
      const report = formatPlatoonStatusReport({
        platoonCode,
        platoonLabel: platoonLabel(platoonsDoc, platoonCode),
        from: fromStatus,
        target: toStatus,
        fromDate,
        throughDate: toDate,
        updates: plan.updates,
        unchanged: plan.unchanged,
      });
      const payloads = buildPlatoonStatusImportPayloads(
        plan.updates,
        planDayStartHour,
        toStatus,
        note,
      );
      for (const payload of payloads) {
        await importSoldierStatus(payload);
      }
      return report;
    },
    onSuccess: (report) => {
      setLastReport(report);
      onSaved();
    },
    onError: (e: Error) => setError(formatApiError(e)),
  });

  const handleCopyReport = () => {
    const text = lastReport ?? reportText;
    if (!text) return;
    void copyPlatoonStatusReport(text)
      .then(() => {
        setCopyHint("Report copied");
        setTimeout(() => setCopyHint(null), 2000);
      })
      .catch(() => setCopyHint("Could not copy"));
  };

  if (!open) return null;

  const updateSoldierCount = new Set(preview?.updates.map((u) => u.soldier.id) ?? []).size;
  const unchangedSoldierCount = preview?.unchanged.length ?? 0;

  return (
    <div className="contacts-sheet-backdrop" role="presentation" onPointerDown={onClose}>
      <div
        className="contacts-edit-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="platoon-status-title"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="contacts-sheet-nav">
          <button type="button" className="contacts-nav-btn" onPointerDown={onClose}>
            {lastReport ? "Done" : "Cancel"}
          </button>
          <h2 id="platoon-status-title" className="contacts-sheet-title">
            Platoon status
          </h2>
          {!lastReport ? (
            <button
              type="button"
              className="contacts-nav-btn contacts-nav-btn-primary"
              disabled={
                !platoonCode ||
                planDays.length === 0 ||
                rangeTooLong ||
                mutate.isPending ||
                previewLoading ||
                updateSoldierCount === 0
              }
              onPointerDown={() => mutate.mutate()}
            >
              Apply
            </button>
          ) : (
            <button type="button" className="contacts-nav-btn contacts-nav-btn-primary" onPointerDown={onClose}>
              Close
            </button>
          )}
        </header>

        {lastReport ? (
          <section className="glass-card platoon-vacation-preview" style={{ margin: "0 1rem 1rem" }}>
            <p className="contacts-count">Applied. Report:</p>
            <pre className="platoon-status-report">{lastReport}</pre>
            <div className="platoon-status-report-actions">
              <button type="button" className="btn btn-tinted" onClick={handleCopyReport}>
                Copy report
              </button>
              {copyHint && <span className="contacts-hint">{copyHint}</span>}
            </div>
          </section>
        ) : (
          <>
            <section className="glass-card contacts-editor-fields">
              <p className="contacts-hint platoon-vacation-intro">
                Soldiers in <strong>From state</strong> on <em>every</em> plan day in the range move to{" "}
                <strong>To state</strong> for the whole range ({planDayStartLabel} → {planDayStartLabel} next day).
                Anyone not in that state on all days is left unchanged and listed in the report.
              </p>
              {platoonOptions.length === 0 ? (
                <p className="contacts-empty">No platoons on the roster. Assign platoon codes first.</p>
              ) : (
                <>
                  <label className="settings-row">
                    <span className="settings-row-label title">Platoon</span>
                    <select
                      className="settings-input settings-input-wide"
                      value={platoonCode}
                      onChange={(e) => setPlatoonCode(e.target.value)}
                    >
                      {platoonOptions.map((p) => (
                        <option key={p.code} value={p.code}>
                          {p.code} — {p.label} ({p.count})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="settings-row">
                    <span className="settings-row-label title">From state</span>
                    <select
                      className="settings-input settings-input-wide"
                      value={fromStatus}
                      onChange={(e) => setFromStatus(e.target.value as PlatoonTargetStatus)}
                    >
                      {STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="settings-row">
                    <span className="settings-row-label title">To state</span>
                    <select
                      className="settings-input settings-input-wide"
                      value={toStatus}
                      onChange={(e) => setToStatus(e.target.value as PlatoonTargetStatus)}
                    >
                      {STATUS_OPTIONS.map((o) => (
                        <option key={`to-${o.value}`} value={o.value}>
                          {o.label === "On base" ? "On base (clear status)" : o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="settings-row">
                    <span className="settings-row-label title">From plan day</span>
                    <input
                      className="settings-input settings-input-wide"
                      type="date"
                      value={fromDate}
                      onChange={(e) => setFromDate(e.target.value)}
                    />
                  </label>
                  <label className="settings-row">
                    <span className="settings-row-label title">Through plan day</span>
                    <input
                      className="settings-input settings-input-wide"
                      type="date"
                      value={toDate}
                      onChange={(e) => setToDate(e.target.value)}
                    />
                  </label>
                  <label className="settings-row">
                    <span className="settings-row-label title">Note</span>
                    <input
                      className="settings-input settings-input-wide"
                      type="text"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Optional"
                    />
                  </label>
                </>
              )}
            </section>

            {rangeTooLong && (
              <p className="msg-err" style={{ padding: "0 1rem" }}>
                Maximum {MAX_PLATOON_VACATION_DAYS} plan days per change.
              </p>
            )}

            {previewLoading && (
              <p className="contacts-hint" style={{ padding: "0 1rem" }}>
                Loading preview…
              </p>
            )}
            {preview && !previewLoading && (
              <section className="glass-card platoon-vacation-preview" style={{ margin: "0 1rem 1rem" }}>
                <p className="contacts-count">
                  <strong>{updateSoldierCount}</strong> soldier{updateSoldierCount === 1 ? "" : "s"} will move ·{" "}
                  <strong>{statusLabel(fromStatus)}</strong> → <strong>{statusLabel(toStatus)}</strong> · all{" "}
                  {planDays.length} plan day{planDays.length === 1 ? "" : "s"}
                  {unchangedSoldierCount > 0 ? (
                    <>
                      {" "}
                      · <strong>{unchangedSoldierCount}</strong> unchanged
                    </>
                  ) : null}
                </p>
                {unchangedSoldierCount > 0 && (
                  <>
                    <ul className="platoon-vacation-skipped">
                      {preview.unchanged.map((row) => (
                        <li key={row.soldier.id}>
                          {row.soldier.full_name.trim() || row.soldier.id} — {row.reason}:{" "}
                          {row.days.map((d) => `${d.planDay.slice(5)} ${d.currentLabel}`).join(", ")}
                        </li>
                      ))}
                    </ul>
                    <div className="platoon-status-report-actions">
                      <button
                        type="button"
                        className="btn btn-tinted"
                        disabled={!reportText}
                        onClick={handleCopyReport}
                      >
                        Copy report
                      </button>
                      {copyHint && <span className="contacts-hint">{copyHint}</span>}
                    </div>
                  </>
                )}
              </section>
            )}

            {error && <p className="msg-err" style={{ padding: "0 1rem 1rem" }}>{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}

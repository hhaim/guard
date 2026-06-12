import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  clearSoldierStatusWindow,
  createSoldierStatus,
  type SoldierStatusKind,
} from "../api/soldierStatus";
import { formatApiError } from "../lib/apiError";
import { planDayBoundsIso, wallClockIso } from "../lib/planDayBounds";

type Props = {
  open: boolean;
  soldierId: string;
  soldierName: string;
  calendarDate: string;
  planDayStartHour: number;
  planDayStartLabel: string;
  cellKind: "full" | "partial" | "absent";
  onClose: () => void;
  onSaved: () => void;
};

export function StatusCellSheet({
  open,
  soldierId,
  soldierName,
  calendarDate,
  planDayStartHour,
  planDayStartLabel,
  cellKind,
  onClose,
  onSaved,
}: Props) {
  const [returnTime, setReturnTime] = useState("12:00");
  const [outingStartTime, setOutingStartTime] = useState("20:00");
  const [outingHours, setOutingHours] = useState(5);
  const [error, setError] = useState<string | null>(null);

  const mutate = useMutation({
    mutationFn: async (fn: () => Promise<void>) => {
      setError(null);
      await fn();
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (e: Error) => setError(formatApiError(e)),
  });

  if (!open) return null;

  const { start, end } = planDayBoundsIso(calendarDate, planDayStartHour);

  const setOnBase = () => {
    mutate.mutate(() =>
      clearSoldierStatusWindow({
        soldier_id: soldierId,
        start_at: start,
        end_at: end,
      }).then(() => undefined),
    );
  };

  const setPlanDayStatus = (status: SoldierStatusKind) => {
    mutate.mutate(async () => {
      await clearSoldierStatusWindow({
        soldier_id: soldierId,
        start_at: start,
        end_at: end,
      });
      await createSoldierStatus({
        soldier_id: soldierId,
        start_at: start,
        end_at: end,
        status,
      });
    });
  };

  const onBase = cellKind === "full";

  const setReturnsAt = () => {
    const returnAt = wallClockIso(calendarDate, returnTime);
    if (returnAt <= start || returnAt >= end) {
      setError(`Return time must be inside plan day (${planDayStartLabel}–${planDayStartLabel} next day)`);
      return;
    }
    mutate.mutate(() =>
      createSoldierStatus({
        soldier_id: soldierId,
        start_at: start,
        end_at: returnAt,
        status: "away",
      }).then(() => undefined),
    );
  };

  const addOuting = () => {
    const outingStartIso = wallClockIso(calendarDate, outingStartTime);
    const startMs = new Date(outingStartIso).getTime();
    const endMs = startMs + outingHours * 3600 * 1000;
    const outingEnd = new Date(endMs).toISOString();
    if (outingEnd <= outingStartIso || outingStartIso < start || outingEnd > end) {
      setError(`Outing must fit inside plan day (${planDayStartLabel}→${planDayStartLabel})`);
      return;
    }
    mutate.mutate(() =>
      createSoldierStatus({
        soldier_id: soldierId,
        start_at: outingStartIso,
        end_at: outingEnd,
        status: "outing",
      }).then(() => undefined),
    );
  };

  return (
    <div className="contacts-sheet-backdrop" role="presentation" onPointerDown={onClose}>
      <div
        className="contacts-edit-sheet status-cell-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="status-cell-title"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="contacts-sheet-nav">
          <button type="button" className="contacts-nav-btn" onPointerDown={onClose}>
            Cancel
          </button>
          <h2 id="status-cell-title" className="contacts-sheet-title">
            {soldierName}
          </h2>
          <span className="contacts-nav-btn" aria-hidden />
        </header>

        <p className="status-sheet-meta">
          Plan day <strong>{calendarDate}</strong> ({planDayStartLabel} → {planDayStartLabel} next day)
          <br />
          Current: <strong>{cellKind === "full" ? "Full" : cellKind === "partial" ? "Partial" : "Absent"}</strong>
        </p>

        <section className="glass-card status-action-list">
          <p className="settings-section-header">On base</p>
          <button
            type="button"
            className={`btn status-action-btn${onBase ? " btn-filled" : " btn-tinted"}`}
            disabled={mutate.isPending || onBase}
            onClick={setOnBase}
          >
            {onBase ? "On base (this plan day)" : "Clear status — on base"}
          </button>
          <p className="contacts-hint">
            Removes away, sick, training, and outings for this plan day so the soldier is fully available.
          </p>
        </section>

        <section className="glass-card status-action-list">
          <p className="settings-section-header">Mark whole plan day</p>
          <button
            type="button"
            className="btn btn-tinted status-action-btn"
            disabled={mutate.isPending}
            onClick={() => setPlanDayStatus("away")}
          >
            Away this plan day
          </button>
          <button
            type="button"
            className="btn btn-tinted status-action-btn"
            disabled={mutate.isPending}
            onClick={() => setPlanDayStatus("sick")}
          >
            Sick this plan day
          </button>
          <button
            type="button"
            className="btn btn-tinted status-action-btn"
            disabled={mutate.isPending}
            onClick={() => setPlanDayStatus("training")}
          >
            Training this plan day
          </button>
        </section>

        <section className="glass-card status-action-list">
          <p className="settings-section-header">Partial plan day</p>
          <label className="status-inline-field">
            <span>Returns at (wall clock)</span>
            <input
              className="settings-input"
              type="time"
              value={returnTime}
              onChange={(e) => setReturnTime(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn btn-filled status-action-btn"
            disabled={mutate.isPending}
            onClick={setReturnsAt}
          >
            Away until return time
          </button>
          <label className="status-inline-field">
            <span>Outing start</span>
            <input
              className="settings-input"
              type="time"
              value={outingStartTime}
              onChange={(e) => setOutingStartTime(e.target.value)}
            />
          </label>
          <label className="status-inline-field">
            <span>Duration (hours)</span>
            <input
              className="settings-input"
              type="number"
              min={1}
              max={12}
              value={outingHours}
              onChange={(e) => setOutingHours(Number(e.target.value))}
            />
          </label>
          <button
            type="button"
            className="btn btn-tinted status-action-btn"
            disabled={mutate.isPending}
            onClick={addOuting}
          >
            Add outing
          </button>
        </section>

        {error && <p className="msg-err status-sheet-error">{error}</p>}
        {mutate.isPending && <p className="contacts-hint">Saving…</p>}
      </div>
    </div>
  );
}

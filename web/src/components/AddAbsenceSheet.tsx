import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { createSoldierStatus, type SoldierStatusKind } from "../api/soldierStatus";
import { planDayBoundsIso } from "../lib/planDayBounds";
import { enumeratePlanDays } from "../lib/planDayRange";
import type { Soldier } from "../lib/soldiers";

type Props = {
  open: boolean;
  soldiers: Soldier[];
  anchorDate: string;
  planDayStartHour: number;
  onClose: () => void;
  onSaved: () => void;
};

export function AddAbsenceSheet({
  open,
  soldiers,
  anchorDate,
  planDayStartHour,
  onClose,
  onSaved,
}: Props) {
  const [soldierId, setSoldierId] = useState(soldiers[0]?.id ?? "");
  const [status, setStatus] = useState<SoldierStatusKind>("away");
  const [fromDate, setFromDate] = useState(anchorDate);
  const [toDate, setToDate] = useState(anchorDate);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutate = useMutation({
    mutationFn: async () => {
      setError(null);
      const days = enumeratePlanDays(fromDate, toDate);
      if (days.length === 0) throw new Error("Invalid date range");
      for (const d of days) {
        const { start, end } = planDayBoundsIso(d, planDayStartHour);
        await createSoldierStatus({
          soldier_id: soldierId,
          start_at: start,
          end_at: end,
          status,
          note: note.trim() || undefined,
        });
      }
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  if (!open) return null;

  return (
    <div className="contacts-sheet-backdrop" role="presentation" onPointerDown={onClose}>
      <div
        className="contacts-edit-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-absence-title"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="contacts-sheet-nav">
          <button type="button" className="contacts-nav-btn" onPointerDown={onClose}>
            Cancel
          </button>
          <h2 id="add-absence-title" className="contacts-sheet-title">
            Add absence
          </h2>
          <button
            type="button"
            className="contacts-nav-btn contacts-nav-btn-primary"
            disabled={!soldierId || mutate.isPending}
            onPointerDown={() => mutate.mutate()}
          >
            Save
          </button>
        </header>

        <section className="glass-card contacts-editor-fields">
          <label className="settings-row">
            <span className="settings-row-label title">Soldier</span>
            <select
              className="settings-input settings-input-wide"
              value={soldierId}
              onChange={(e) => setSoldierId(e.target.value)}
            >
              {soldiers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name.trim() || s.id}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-row">
            <span className="settings-row-label title">Status</span>
            <select
              className="settings-input settings-input-wide"
              value={status}
              onChange={(e) => setStatus(e.target.value as SoldierStatusKind)}
            >
              <option value="away">Away</option>
              <option value="sick">Sick</option>
              <option value="training">Training</option>
              <option value="other">Other</option>
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
        </section>

        <p className="contacts-hint" style={{ padding: "0 1rem 1rem" }}>
          Each selected day is stored as one plan-day window (05:00→05:00 style from global config).
        </p>
        {error && <p className="msg-err">{error}</p>}
      </div>
    </div>
  );
}

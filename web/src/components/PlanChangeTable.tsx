import { Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import type { PlanChange, ProposalDoc } from "../api/plan";
import { buildZoneReportView, type ScheduleAssignment } from "../lib/scheduleReport";
import type { ZonesDoc } from "../lib/zones";

function datesInRange(anchor: string, days: number): string[] {
  const out: string[] = [];
  const start = new Date(`${anchor}T00:00:00Z`);
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function dayOffset(anchor: string, tsDate: string): number {
  const a = new Date(`${anchor}T00:00:00Z`).getTime();
  const t = new Date(`${tsDate}T00:00:00Z`).getTime();
  return Math.round((t - a) / 86400000);
}

function slotLabels(zones: ZonesDoc): string[] {
  return buildZoneReportView(zones, zones.slots.length).slotLabels;
}

function shiftsFor(
  assignments: ScheduleAssignment[],
  anchor: string,
  tsDate: string,
  slotLabel: string,
  labels: string[]
): { shift_index: number; label: string }[] {
  const day = dayOffset(anchor, tsDate);
  const slotIdx = labels.indexOf(slotLabel);
  const seen = new Map<number, string>();
  for (const a of assignments) {
    if (a.day !== day) continue;
    if (slotIdx >= 0 && a.slot !== slotIdx) continue;
    const h0 = a.start_hour;
    const h1 = (h0 + 4) % 24;
    const label = `${String(h0).padStart(2, "0")}:00–${String(h1).padStart(2, "0")}:00`;
    seen.set(a.calendar_block, label);
  }
  return [...seen.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([shift_index, label]) => ({ shift_index, label }));
}

function findAssignment(
  assignments: ScheduleAssignment[],
  anchor: string,
  tsDate: string,
  slotLabel: string,
  shiftIndex: number,
  labels: string[]
): ScheduleAssignment | undefined {
  const day = dayOffset(anchor, tsDate);
  const slotIdx = labels.indexOf(slotLabel);
  return assignments.find(
    (a) => a.day === day && a.calendar_block === shiftIndex && (slotIdx < 0 || a.slot === slotIdx)
  );
}

type Props = {
  proposal: ProposalDoc;
  zones: ZonesDoc;
  soldiers: string[];
  onChange: (next: ProposalDoc) => void;
};

function ChangeField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="plan-change-field">
      <span className="plan-change-field-label">{label}</span>
      {children}
    </label>
  );
}

export function PlanChangeTable({ proposal, zones, soldiers, onChange }: Props) {
  const dates = datesInRange(proposal.anchor_date, proposal.days);
  const slots = slotLabels(zones);
  const changes = proposal.changes ?? [];

  const updateRow = (index: number, patch: Partial<PlanChange>) => {
    const next = changes.map((c, i) => (i === index ? { ...c, ...patch } : c));
    onChange({ ...proposal, changes: next });
  };

  const removeRow = (index: number) => {
    onChange({ ...proposal, changes: changes.filter((_, i) => i !== index) });
  };

  const addRow = () => {
    const shiftOpts = shiftsFor(
      proposal.assignments,
      proposal.anchor_date,
      dates[0] ?? proposal.anchor_date,
      slots[0] ?? "",
      slots
    );
    onChange({
      ...proposal,
      changes: [
        ...changes,
        {
          ts_date: dates[0] ?? proposal.anchor_date,
          slot: slots[0] ?? "",
          shift_index: shiftOpts[0]?.shift_index ?? 0,
          shift_label: shiftOpts[0]?.label,
          old_soldier_id: "",
          new_soldier_id: soldiers[0] ?? "",
        },
      ],
    });
  };

  const applyRow = (index: number) => {
    const ch = changes[index];
    if (!ch.ts_date || !ch.slot || !ch.new_soldier_id) return;
    const labels = slotLabels(zones);
    const target = findAssignment(
      proposal.assignments,
      proposal.anchor_date,
      ch.ts_date,
      ch.slot,
      ch.shift_index,
      labels
    );
    if (!target) return;
    const oldId = target.soldier_id ?? soldiers[target.soldier_idx] ?? "";
    const si = soldiers.indexOf(ch.new_soldier_id);
    const updated = proposal.assignments.map((a) => {
      if (a.day === target.day && a.calendar_block === target.calendar_block && a.slot === target.slot) {
        return {
          ...a,
          soldier_id: ch.new_soldier_id,
          soldier_idx: si >= 0 ? si : a.soldier_idx,
        };
      }
      return a;
    });
    const nextChanges = changes.map((c, i) =>
      i === index ? { ...c, old_soldier_id: oldId } : c
    );
    onChange({ ...proposal, assignments: updated, changes: nextChanges });
  };

  return (
    <section className="glass-card plan-changes-card">
      <header className="plan-changes-header">
        <div>
          <h3>Manual swaps</h3>
          <p className="contacts-hint" style={{ margin: "0.25rem 0 0" }}>
            Fill each row, then <strong>Apply swap</strong> to update the matrix. <strong>Save proposal</strong> in
            the toolbar stores everything.
          </p>
        </div>
        <button type="button" className="btn btn-tinted" onClick={addRow}>
          <Plus size={16} />
          Add swap
        </button>
      </header>
      {changes.length === 0 ? (
        <p className="contacts-hint" style={{ padding: "0 1rem 1rem" }}>
          No swap rows yet.
        </p>
      ) : (
        <div className="plan-changes-list">
          {changes.map((ch, i) => {
            const shiftOpts = shiftsFor(
              proposal.assignments,
              proposal.anchor_date,
              ch.ts_date,
              ch.slot,
              slots
            );
            const current = findAssignment(
              proposal.assignments,
              proposal.anchor_date,
              ch.ts_date,
              ch.slot,
              ch.shift_index,
              slots
            );
            const oldAuto =
              current?.soldier_id ?? (current ? soldiers[current.soldier_idx] : "") ?? "";

            return (
              <article key={i} className="plan-change-row">
                <div className="plan-change-row-title">Swap {i + 1}</div>
                <div className="plan-change-grid">
                  <ChangeField label="Date">
                    <select
                      className="settings-input plan-change-input"
                      value={ch.ts_date}
                      onChange={(e) => updateRow(i, { ts_date: e.target.value })}
                    >
                      {dates.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </ChangeField>

                  <ChangeField label="Slot">
                    <select
                      className="settings-input plan-change-input"
                      value={ch.slot}
                      onChange={(e) => updateRow(i, { slot: e.target.value })}
                    >
                      {slots.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </ChangeField>

                  <ChangeField label="Shift">
                    <select
                      className="settings-input plan-change-input"
                      value={ch.shift_index}
                      onChange={(e) => {
                        const si = Number(e.target.value);
                        const opt = shiftOpts.find((o) => o.shift_index === si);
                        updateRow(i, {
                          shift_index: si,
                          shift_label: opt?.label,
                        });
                      }}
                    >
                      {shiftOpts.map((o) => (
                        <option key={o.shift_index} value={o.shift_index}>
                          {o.label} (block {o.shift_index})
                        </option>
                      ))}
                    </select>
                  </ChangeField>

                  <ChangeField label="Current soldier">
                    <div className="plan-change-readonly">{ch.old_soldier_id || oldAuto || "—"}</div>
                  </ChangeField>

                  <ChangeField label="New soldier">
                    <select
                      className="settings-input plan-change-input"
                      value={ch.new_soldier_id}
                      onChange={(e) => updateRow(i, { new_soldier_id: e.target.value })}
                    >
                      {soldiers.map((id) => (
                        <option key={id} value={id}>
                          {id}
                        </option>
                      ))}
                    </select>
                  </ChangeField>
                </div>

                <div className="plan-change-row-actions">
                  <button type="button" className="btn btn-filled" onClick={() => applyRow(i)}>
                    Apply swap
                  </button>
                  <button
                    type="button"
                    className="btn btn-tinted"
                    aria-label="Remove swap"
                    onClick={() => removeRow(i)}
                  >
                    <Trash2 size={16} />
                    Remove
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

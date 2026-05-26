import { useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { fetchPlanContext } from "../api/plan";
import { parsePlanDayStart } from "../lib/planDay";
import { soldierInitials, type Soldier } from "../lib/soldiers";
import { SoldierStatusTimeline } from "./SoldierStatusTimeline";

type SoldierEditorSheetProps = {
  open: boolean;
  mode: "edit" | "new";
  soldier: Soldier;
  onChange: (s: Soldier) => void;
  onDone: () => void;
  onCancel: () => void;
  onDelete?: () => void;
};

function TextRow({
  label,
  value,
  onChange,
  placeholder,
  autoCapitalize = "words",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoCapitalize?: "off" | "words" | "none";
}) {
  return (
    <div className="settings-row">
      <label className="settings-row-label">
        <span className="title">{label}</span>
      </label>
      <input
        className="settings-input settings-input-wide"
        type="text"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize={autoCapitalize}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function SoldierEditorSheet({
  open,
  mode,
  soldier,
  onChange,
  onDone,
  onCancel,
  onDelete,
}: SoldierEditorSheetProps) {
  if (!open) return null;

  const title = mode === "new" ? "New Soldier" : "Edit";
  const canDone = soldier.id.trim() !== "";

  const planCtxQ = useQuery({
    queryKey: ["plan", "context"],
    queryFn: () => fetchPlanContext(),
    enabled: open && mode === "edit",
  });
  const anchor = planCtxQ.data?.plan_anchor ?? "";
  const startParsed = parsePlanDayStart(planCtxQ.data?.plan_day_start ?? "05:00");
  const planDayStartHour = startParsed.ok ? startParsed.hour : 5;

  return (
    <div className="contacts-sheet-backdrop" role="presentation" onPointerDown={onCancel}>
      <div
        className="contacts-edit-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="soldier-editor-title"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="contacts-sheet-nav">
          <button type="button" className="contacts-nav-btn" onPointerDown={() => onCancel()}>
            Cancel
          </button>
          <h2 id="soldier-editor-title" className="contacts-sheet-title">
            {title}
          </h2>
          <button
            type="button"
            className="contacts-nav-btn contacts-nav-btn-primary"
            disabled={!canDone}
            onPointerDown={() => canDone && onDone()}
          >
            Done
          </button>
        </header>

        <div className="contacts-editor-hero">
          <div className="contacts-avatar contacts-avatar-lg" aria-hidden>
            {soldierInitials(soldier)}
          </div>
        </div>

        <section className="glass-card contacts-editor-fields">
          <TextRow
            label="Full name"
            value={soldier.full_name}
            onChange={(full_name) => onChange({ ...soldier, full_name })}
            placeholder="Required for display"
          />
          <TextRow
            label="ID"
            value={soldier.id}
            onChange={(id) => onChange({ ...soldier, id: id.trim() })}
            placeholder="e.g. s0"
            autoCapitalize="none"
          />
        </section>

        {mode === "edit" && anchor && soldier.id.trim() && (
          <SoldierStatusTimeline
            soldierId={soldier.id.trim()}
            anchorDate={anchor}
            planDayStartHour={planDayStartHour}
          />
        )}

        {mode === "edit" && onDelete && (
          <button type="button" className="btn btn-destructive contacts-delete-btn" onPointerDown={() => onDelete()}>
            <Trash2 size={18} strokeWidth={2} />
            Delete soldier
          </button>
        )}
      </div>
    </div>
  );
}

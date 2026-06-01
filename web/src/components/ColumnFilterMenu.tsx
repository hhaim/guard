import { Filter } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export type ColumnFilterOption = {
  value: string;
  label: string;
};

type ColumnFilterMenuProps = {
  label: string;
  options: ColumnFilterOption[];
  /** null = show all (no filter) */
  selected: Set<string> | null;
  onChange: (next: Set<string> | null) => void;
};

export function ColumnFilterMenu({ label, options, selected, onChange }: ColumnFilterMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const active = selected != null && selected.size > 0 && selected.size < options.length;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const toggleValue = (value: string) => {
    const base = selected ?? new Set(options.map((o) => o.value));
    const next = new Set(base);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    if (next.size === 0 || next.size === options.length) {
      onChange(null);
      return;
    }
    onChange(next);
  };

  return (
    <div className="column-filter-wrap" ref={rootRef}>
      <button
        type="button"
        className={`column-filter-btn${active ? " column-filter-btn-active" : ""}`}
        aria-label={`Filter ${label}`}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        <Filter size={14} strokeWidth={2} />
      </button>
      {open && (
        <div id={menuId} className="column-filter-menu" role="dialog" aria-label={`${label} filter`}>
          <div className="column-filter-actions">
            <button
              type="button"
              className="btn btn-plain column-filter-action"
              onClick={() => onChange(null)}
            >
              Select all
            </button>
            <button
              type="button"
              className="btn btn-plain column-filter-action"
              onClick={() => onChange(null)}
            >
              Clear
            </button>
          </div>
          <ul className="column-filter-list">
            {options.map((opt) => {
              const checked = selected == null || selected.has(opt.value);
              return (
                <li key={opt.value}>
                  <label className="column-filter-item">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleValue(opt.value)}
                    />
                    <span>{opt.label}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

import { Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { emptyPlatoon, collectUsedPlatoonCodes, type Platoon } from "../lib/soldierPlatoons";
import { useSoldierPlatoonsDocument } from "../hooks/useSoldierPlatoonsDocument";
import { ContactsRowEditButton } from "./ContactsRowEdit";
import { ZoneEditSheet } from "./ZoneEditSheet";
import type { Soldier } from "../lib/soldiers";

type SoldierPlatoonsSectionProps = {
  platoons: ReturnType<typeof useSoldierPlatoonsDocument>;
  soldiers: Soldier[];
  searchTerm?: string;
  onOpenPlatoonsJson?: () => void;
};

function Field({
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
  autoCapitalize?: "off" | "words" | "none" | "characters";
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

export function SoldierPlatoonsSection({
  platoons,
  soldiers,
  searchTerm = "",
  onOpenPlatoonsJson,
}: SoldierPlatoonsSectionProps) {
  const { platoonsQ, doc, markDirty, dirty, saveState, saveError, jsonError } = platoons;

  const [edit, setEdit] = useState<{ mode: "new" | "edit"; index: number; draft: Platoon } | null>(null);

  const commitEdit = useCallback(() => {
    if (!edit) return;
    const nextPlatoons = [...doc.platoons];
    const row = { ...edit.draft, code: edit.draft.code.trim(), label: edit.draft.label.trim() };
    if (edit.mode === "new") {
      nextPlatoons.push(row);
    } else {
      nextPlatoons[edit.index] = row;
    }
    markDirty({ ...doc, platoons: nextPlatoons });
    setEdit(null);
  }, [doc, edit, markDirty]);

  const sorted = useMemo(
    () => [...doc.platoons].sort((a, b) => a.code.localeCompare(b.code, undefined, { sensitivity: "base" })),
    [doc.platoons]
  );
  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((p) => {
      const own = `${p.code} ${p.label}`.toLowerCase();
      if (own.includes(q)) return true;
      return soldiers.some((s) => {
        if ((s.platoon_code?.trim() ?? "") !== p.code) return false;
        const soldierText = `${s.id} ${s.full_name}`.toLowerCase();
        return soldierText.includes(q);
      });
    });
  }, [searchTerm, soldiers, sorted]);

  const indexByCode = useMemo(() => new Map(doc.platoons.map((p, i) => [p.code, i])), [doc.platoons]);
  const usedPlatoonCodes = useMemo(() => collectUsedPlatoonCodes(soldiers), [soldiers]);

  const statusLabel =
    saveState === "pending"
      ? "Saving platoons…"
      : saveState === "saved"
        ? "Platoons saved"
        : saveState === "error"
          ? "Platoons save failed"
          : dirty
            ? "Platoons pending save…"
            : "";

  return (
    <section className="soldiers-types-section" aria-label="Soldier platoons">
      <header className="soldiers-roster-header">
        <div>
          <p className="contacts-count">
            Platoon codes for roster grouping and schedule badge colors.
            {statusLabel ? ` · ${statusLabel}` : ""}
          </p>
        </div>
        <div className="contacts-toolbar-actions">
          {onOpenPlatoonsJson && (
            <button
              type="button"
              className="btn btn-tinted contacts-json-btn"
              aria-label="Show platoons JSON in developer panel"
              onClick={() => onOpenPlatoonsJson()}
            >
              <span className="contacts-json-btn-label">Platoons JSON</span>
            </button>
          )}
          <button
            type="button"
            className="contacts-add-btn"
            aria-label="Add platoon"
            onPointerDown={(e) => {
              e.preventDefault();
              setEdit({ mode: "new", index: doc.platoons.length, draft: emptyPlatoon(doc.platoons) });
            }}
          >
            <Plus size={22} strokeWidth={2.5} />
          </button>
        </div>
      </header>

      <div className="glass-card contacts-list-card">
        {platoonsQ.isLoading && <p className="contacts-empty">Loading platoons…</p>}
        {!platoonsQ.isLoading && sorted.length === 0 && (
          <p className="contacts-empty">No platoons yet. Add codes (e.g. 1 → chod) before assigning soldiers.</p>
        )}
        {!platoonsQ.isLoading && sorted.length > 0 && filtered.length === 0 && (
          <p className="contacts-empty">No platoons match the current search.</p>
        )}
        {filtered.length > 0 && (
          <table className="contacts-table">
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Label</th>
                <th className="contacts-th-chevron" scope="col" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const index = indexByCode.get(p.code) ?? -1;
                return (
                  <tr
                    key={p.code}
                    className="contacts-row"
                    onDoubleClick={() => index >= 0 && setEdit({ mode: "edit", index, draft: { ...p } })}
                  >
                    <td className="contacts-id">
                      <code>{p.code}</code>
                    </td>
                    <td className="contacts-name">{p.label}</td>
                    <ContactsRowEditButton
                      label={`Edit platoon ${p.code}`}
                      onEdit={() => index >= 0 && setEdit({ mode: "edit", index, draft: { ...p } })}
                    />
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {saveError && <p className="msg-err">{saveError}</p>}
      {jsonError && dirty && <p className="msg-err">{jsonError}</p>}
      {platoonsQ.isError && <p className="msg-err">{(platoonsQ.error as Error).message}</p>}

      {edit && (
        <ZoneEditSheet
          open
          title={edit.mode === "new" ? "New platoon" : "Edit platoon"}
          canDone={!!edit.draft.code.trim() && !!edit.draft.label.trim() && edit.draft.code.trim().length <= 4}
          onDone={commitEdit}
          onCancel={() => setEdit(null)}
          footer={
            edit.mode === "edit" ? (
              <button
                type="button"
                className="btn btn-destructive contacts-delete-btn"
                onPointerDown={() => {
                  const existingCode = doc.platoons[edit.index]?.code?.trim() ?? "";
                  if (existingCode && usedPlatoonCodes.has(existingCode)) {
                    alert(`Platoon "${existingCode}" is assigned to at least one soldier and cannot be deleted.`);
                    return;
                  }
                  const nextPlatoons = doc.platoons.filter((_, i) => i !== edit.index);
                  markDirty({ ...doc, platoons: nextPlatoons });
                  setEdit(null);
                }}
                disabled={Boolean(
                  doc.platoons[edit.index]?.code?.trim() &&
                    usedPlatoonCodes.has(doc.platoons[edit.index].code.trim())
                )}
              >
                {doc.platoons[edit.index]?.code?.trim() &&
                usedPlatoonCodes.has(doc.platoons[edit.index].code.trim())
                  ? "Platoon is in use"
                  : "Delete platoon"}
              </button>
            ) : undefined
          }
        >
          <section className="glass-card">
            <Field
              label="Code"
              value={edit.draft.code}
              onChange={(code) => setEdit({ ...edit, draft: { ...edit.draft, code } })}
              placeholder="1–4 characters"
              autoCapitalize="characters"
            />
            <Field
              label="Label"
              value={edit.draft.label}
              onChange={(label) => setEdit({ ...edit, draft: { ...edit.draft, label } })}
              placeholder="e.g. chod"
            />
          </section>
        </ZoneEditSheet>
      )}
    </section>
  );
}

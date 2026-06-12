import { Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { emptyType, type SoldierType } from "../lib/soldierTypes";
import { useSoldierTypesDocument } from "../hooks/useSoldierTypesDocument";
import { ContactsRowEditButton } from "./ContactsRowEdit";
import { ZoneEditSheet } from "./ZoneEditSheet";
import type { Soldier } from "../lib/soldiers";

type SoldierTypesSectionProps = {
  types: ReturnType<typeof useSoldierTypesDocument>;
  soldiers: Soldier[];
  searchTerm?: string;
  onOpenTypesJson?: () => void;
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

export function SoldierTypesSection({ types, soldiers, searchTerm = "", onOpenTypesJson }: SoldierTypesSectionProps) {
  const { typesQ, doc, markDirty, dirty, saveState, saveError, jsonError } = types;

  const [edit, setEdit] = useState<{ mode: "new" | "edit"; index: number; draft: SoldierType } | null>(null);

  const commitEdit = useCallback(() => {
    if (!edit) return;
    const nextTypes = [...doc.types];
    const row = { ...edit.draft, code: edit.draft.code.trim(), label: edit.draft.label.trim() };
    if (edit.mode === "new") {
      nextTypes.push(row);
    } else {
      nextTypes[edit.index] = row;
    }
    markDirty({ ...doc, types: nextTypes });
    setEdit(null);
  }, [doc, edit, markDirty]);

  const sorted = useMemo(
    () => [...doc.types].sort((a, b) => a.code.localeCompare(b.code, undefined, { sensitivity: "base" })),
    [doc.types]
  );
  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((t) => {
      const own = `${t.code} ${t.label}`.toLowerCase();
      if (own.includes(q)) return true;
      return soldiers.some((s) => {
        if ((s.type_code?.trim() ?? "") !== t.code) return false;
        const soldierText = `${s.id} ${s.full_name}`.toLowerCase();
        return soldierText.includes(q);
      });
    });
  }, [searchTerm, soldiers, sorted]);

  const indexByCode = useMemo(() => new Map(doc.types.map((t, i) => [t.code, i])), [doc.types]);
  const usedTypeCodes = useMemo(
    () =>
      new Set(
        soldiers
          .map((s) => s.type_code?.trim())
          .filter((code): code is string => Boolean(code))
      ),
    [soldiers]
  );

  const statusLabel =
    saveState === "pending"
      ? "Saving types…"
      : saveState === "saved"
        ? "Types saved"
        : saveState === "error"
          ? "Types save failed"
          : dirty
            ? "Types pending save…"
            : "";

  return (
    <section className="soldiers-types-section" aria-label="Soldier types">
      <header className="soldiers-roster-header">
        <div>
          <p className="contacts-count">
            Rank/role codes shown beside roster names (e.g. A, B).
            {statusLabel ? ` · ${statusLabel}` : ""}
          </p>
        </div>
        <div className="contacts-toolbar-actions">
          {onOpenTypesJson && (
            <button
              type="button"
              className="btn btn-tinted contacts-json-btn"
              aria-label="Show types JSON in developer panel"
              onClick={() => onOpenTypesJson()}
            >
              <span className="contacts-json-btn-label">Types JSON</span>
            </button>
          )}
          <button
            type="button"
            className="contacts-add-btn"
            aria-label="Add soldier type"
            onPointerDown={(e) => {
              e.preventDefault();
              setEdit({ mode: "new", index: doc.types.length, draft: emptyType(doc.types) });
            }}
          >
            <Plus size={22} strokeWidth={2.5} />
          </button>
        </div>
      </header>

      <div className="glass-card contacts-list-card">
        {typesQ.isLoading && <p className="contacts-empty">Loading types…</p>}
        {!typesQ.isLoading && sorted.length === 0 && (
          <p className="contacts-empty">No types yet. Add codes (e.g. A → Private) before assigning soldiers.</p>
        )}
        {!typesQ.isLoading && sorted.length > 0 && filtered.length === 0 && (
          <p className="contacts-empty">No types match the current search.</p>
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
              {filtered.map((t) => {
                const index = indexByCode.get(t.code) ?? -1;
                return (
                  <tr
                    key={t.code}
                    className="contacts-row"
                    onDoubleClick={() => index >= 0 && setEdit({ mode: "edit", index, draft: { ...t } })}
                  >
                    <td className="contacts-id">
                      <code>{t.code}</code>
                    </td>
                    <td className="contacts-name">{t.label}</td>
                    <ContactsRowEditButton
                      label={`Edit type ${t.code}`}
                      onEdit={() => index >= 0 && setEdit({ mode: "edit", index, draft: { ...t } })}
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
      {typesQ.isError && <p className="msg-err">{(typesQ.error as Error).message}</p>}

      {edit && (
        <ZoneEditSheet
          open
          title={edit.mode === "new" ? "New type" : "Edit type"}
          canDone={!!edit.draft.code.trim() && !!edit.draft.label.trim() && edit.draft.code.trim().length <= 4}
          onDone={commitEdit}
          onCancel={() => setEdit(null)}
          footer={
            edit.mode === "edit" ? (
              <button
                type="button"
                className="btn btn-destructive contacts-delete-btn"
                onPointerDown={() => {
                  const existingCode = doc.types[edit.index]?.code?.trim() ?? "";
                  if (existingCode && usedTypeCodes.has(existingCode)) {
                    alert(`Type "${existingCode}" is assigned to at least one soldier and cannot be deleted.`);
                    return;
                  }
                  const nextTypes = doc.types.filter((_, i) => i !== edit.index);
                  markDirty({ ...doc, types: nextTypes });
                  setEdit(null);
                }}
                disabled={Boolean(doc.types[edit.index]?.code?.trim() && usedTypeCodes.has(doc.types[edit.index].code.trim()))}
              >
                {doc.types[edit.index]?.code?.trim() &&
                usedTypeCodes.has(doc.types[edit.index].code.trim())
                  ? "Type is in use"
                  : "Delete type"}
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
              placeholder="e.g. Private_1"
            />
          </section>
        </ZoneEditSheet>
      )}
    </section>
  );
}

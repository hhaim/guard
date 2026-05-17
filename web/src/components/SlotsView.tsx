import { Braces, ChevronRight, Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useDevPanel } from "../context/AppStateContext";
import { useZonesDocument } from "../context/ZonesDocumentContext";
import {
  ALLOWED_SHIFT_HOURS,
  emptyZoneLoc,
  emptySlot,
  emptySlotType,
  normalizeShiftHours,
  zoneLocCountForType,
  slotCountForLocation,
  slotDisplayLabel,
  validateShiftHours,
  zoneLocDisplayLabel,
  zonesDocToYamlObject,
  SLOT_PATTERNS,
  type SlotType,
  type SlotTypePattern,
  type ZoneLoc,
  type ZoneSlot,
  type ZonesDoc,
} from "../lib/zones";
import { ConfigSaveBar } from "./ConfigSaveBar";
import { DevPanelTrigger, DeveloperPanel } from "./DeveloperPanel";
import { ZoneEditSheet } from "./ZoneEditSheet";
import { ZonesYamlToolbar } from "./ZonesYamlToolbar";

function patternLabel(p: string): string {
  return SLOT_PATTERNS.find((x) => x.value === p)?.label ?? p;
}

export function SlotsView() {
  const { openPanel } = useDevPanel();
  const { slotsQ, doc, dirty, loadError, markDirty, replaceDoc, resetToServer, validationError, saveM } =
    useZonesDocument();

  const [jsonOverride, setJsonOverride] = useState<string | null>(null);

  const [stEdit, setStEdit] = useState<{ mode: "new" | "edit"; index: number; draft: SlotType } | null>(null);
  const [locEdit, setLocEdit] = useState<{ mode: "new" | "edit"; index: number; draft: ZoneLoc } | null>(null);
  const [slotEdit, setSlotEdit] = useState<{ mode: "new" | "edit"; index: number; draft: ZoneSlot } | null>(null);

  const liveJson = useMemo(() => {
    if (!doc) return {};
    if (jsonOverride != null) {
      try {
        return JSON.parse(jsonOverride) as Record<string, unknown>;
      } catch {
        return zonesDocToYamlObject(doc);
      }
    }
    return zonesDocToYamlObject(doc);
  }, [doc, jsonOverride]);

  const jsonError = useMemo(() => {
    if (!doc) return null;
    if (jsonOverride != null) {
      try {
        JSON.parse(jsonOverride);
        return validationError;
      } catch (e) {
        return e instanceof Error ? e.message : "Invalid JSON";
      }
    }
    return validationError;
  }, [doc, jsonOverride, validationError]);

  const editorText = jsonOverride ?? (doc ? JSON.stringify(zonesDocToYamlObject(doc), null, 2) : "{}");

  const syncJson = useCallback(
    (text: string) => {
      setJsonOverride(text);
      if (!doc) return;
      try {
        const parsed = JSON.parse(text) as ZonesDoc;
        replaceDoc({
          schema_version: parsed.schema_version ?? doc.schema_version,
          shift_hours: normalizeShiftHours(parsed.shift_hours ?? doc.shift_hours),
          slots_types: parsed.slots_types ?? [],
          zone_loc: parsed.zone_loc ?? [],
          slots: parsed.slots ?? [],
          time_zones: parsed.time_zones ?? doc.time_zones,
        });
      } catch {
        /* invalid */
      }
    },
    [doc, replaceDoc]
  );

  const updateDoc = useCallback(
    (fn: (d: ZonesDoc) => ZonesDoc) => {
      if (!doc) return;
      setJsonOverride(null);
      markDirty(fn(doc));
    },
    [doc, markDirty]
  );

  if (!doc) {
    return slotsQ.isLoading ? <p className="meta-line">Loading zones…</p> : <p className="err">Failed to load zones.</p>;
  }

  const canDeleteType = (id: string) => zoneLocCountForType(doc, id) === 0;
  const canDeleteLoc = (id: string) => slotCountForLocation(doc, id) === 0;

  return (
    <>
      <header className="contacts-toolbar">
        <div className="contacts-toolbar-text">
          <h2 className="contacts-title">Slots & zones</h2>
          <p className="contacts-count">
            {doc.slots_types.length} types · {doc.zone_loc.length} zone locs · {doc.slots.length} slots
            {dirty ? " · unsaved" : ""}
          </p>
        </div>
        <div className="contacts-toolbar-actions">
          <button
            type="button"
            className="btn btn-tinted contacts-json-btn"
            onPointerDown={(e) => {
              e.preventDefault();
              openPanel("json");
            }}
          >
            <Braces size={18} strokeWidth={2} />
            JSON
          </button>
        </div>
      </header>

      <ZonesYamlToolbar disabled={slotsQ.isLoading} doc={doc} onImport={(d) => replaceDoc(d)} />

      {loadError && <div className="err glass-card">{loadError}</div>}

      <div className="settings-row glass-card" style={{ marginBottom: "1rem", padding: "0.65rem 1.1rem" }}>
        <label className="settings-row-label">
          <span className="title">Shift hours</span>
          <span className="hint">Calendar block size (2, 3, or 4)</span>
        </label>
        <select
          className="settings-input settings-input-wide"
          value={normalizeShiftHours(doc.shift_hours)}
          onChange={(e) => {
            const n = Number(e.target.value);
            updateDoc((d) => ({ ...d, shift_hours: validateShiftHours(n) }));
          }}
        >
          {ALLOWED_SHIFT_HOURS.map((h) => (
            <option key={h} value={h}>
              {h} h
            </option>
          ))}
        </select>
      </div>

      {/* Slot types */}
      <SectionHeader
        title="Slot types"
        hint="Define patterns first"
        onAdd={() =>
          setStEdit({ mode: "new", index: doc.slots_types.length, draft: emptySlotType(doc.slots_types.length) })
        }
      />
      <EntityTable
        headers={["Name", "ID", "Pattern", ""]}
        empty="Add a slot type to begin"
        rows={doc.slots_types.map((st, index) => ({
          key: st.id,
          cells: [st.name, st.id, patternLabel(st.pattern)],
          index,
          inUse: !canDeleteType(st.id),
          inUseMsg: `Used by ${zoneLocCountForType(doc, st.id)} zone location(s)`,
        }))}
        onEdit={(index) => setStEdit({ mode: "edit", index, draft: { ...doc.slots_types[index] } })}
      />

      {/* Zone locations */}
      <SectionHeader
        title="Zone locations"
        hint="Each location references a slot type"
        onAdd={() => {
          const typeId = doc.slots_types[0]?.id ?? "";
          if (!typeId) {
            alert("Add a slot type first");
            return;
          }
          setLocEdit({
            mode: "new",
            index: doc.zone_loc.length,
            draft: emptyZoneLoc(doc.zone_loc.length, typeId),
          });
        }}
        disabled={doc.slots_types.length === 0}
      />
      <EntityTable
        headers={["Name", "Short", "ID", "Type", ""]}
        empty={doc.slots_types.length === 0 ? "Add slot types first" : "Add a zone location"}
        rows={doc.zone_loc.map((loc, index) => ({
          key: loc.id,
          cells: [zoneLocDisplayLabel(loc), loc.name, loc.id, loc.type],
          index,
          inUse: !canDeleteLoc(loc.id),
          inUseMsg: `Used by ${slotCountForLocation(doc, loc.id)} slot(s)`,
        }))}
        onEdit={(index) => setLocEdit({ mode: "edit", index, draft: { ...doc.zone_loc[index] } })}
      />

      {/* Slots */}
      <SectionHeader
        title="Slots"
        hint="Concurrent slots per block"
        onAdd={() => {
          const locId = doc.zone_loc[0]?.id ?? "";
          if (!locId) {
            alert("Add a location first");
            return;
          }
          setSlotEdit({
            mode: "new",
            index: doc.slots.length,
            draft: emptySlot(locId, doc.slots.length),
          });
        }}
        disabled={doc.zone_loc.length === 0}
      />
      <EntityTable
        headers={["Name", "Short", "Zone loc", ""]}
        empty={doc.zone_loc.length === 0 ? "Add zone locations first" : "Add a slot"}
        rows={doc.slots.map((sl, index) => ({
          key: `${sl.location_id}-${sl.name}-${index}`,
          cells: [slotDisplayLabel(sl), sl.name, sl.location_id],
          index,
          inUse: false,
        }))}
        onEdit={(index) => setSlotEdit({ mode: "edit", index, draft: { ...doc.slots[index] } })}
      />

      <ConfigSaveBar
        label="Save slots"
        dirty={dirty}
        disabled={!!jsonError || slotsQ.isLoading}
        pending={saveM.isPending}
        error={saveM.isError ? (saveM.error as Error).message : jsonError}
        success={saveM.isSuccess}
        onSave={() => saveM.mutate()}
        onDiscard={resetToServer}
      />
      {slotsQ.data && (
        <p className="meta-line">
          Version {slotsQ.data.version} · updated {new Date(slotsQ.data.updated_at).toLocaleString()}
        </p>
      )}

      <SlotTypeSheet
        edit={stEdit}
        onChange={(draft) => stEdit && setStEdit({ ...stEdit, draft })}
        onDone={() => {
          if (!stEdit) return;
          const types = [...doc.slots_types];
          if (stEdit.mode === "new") types.push(stEdit.draft);
          else types[stEdit.index] = stEdit.draft;
          updateDoc((d) => ({ ...d, slots_types: types }));
          setStEdit(null);
        }}
        onCancel={() => setStEdit(null)}
        onDelete={
          stEdit?.mode === "edit" && canDeleteType(stEdit.draft.id)
            ? () => {
                updateDoc((d) => ({
                  ...d,
                  slots_types: d.slots_types.filter((_, i) => i !== stEdit!.index),
                }));
                setStEdit(null);
              }
            : undefined
        }
        deleteBlocked={
          stEdit?.mode === "edit" ? zoneLocCountForType(doc, stEdit.draft.id) > 0 : false
        }
      />

      <LocationSheet
        edit={locEdit}
        typeOptions={doc.slots_types.map((t) => t.id)}
        onChange={(draft) => locEdit && setLocEdit({ ...locEdit, draft })}
        onDone={() => {
          if (!locEdit) return;
          const locs = [...doc.zone_loc];
          if (locEdit.mode === "new") locs.push(locEdit.draft);
          else locs[locEdit.index] = locEdit.draft;
          updateDoc((d) => ({ ...d, zone_loc: locs }));
          setLocEdit(null);
        }}
        onCancel={() => setLocEdit(null)}
        onDelete={
          locEdit?.mode === "edit" && canDeleteLoc(locEdit.draft.id)
            ? () => {
                updateDoc((d) => ({
                  ...d,
                  zone_loc: d.zone_loc.filter((_, i) => i !== locEdit!.index),
                }));
                setLocEdit(null);
              }
            : undefined
        }
        deleteBlocked={locEdit?.mode === "edit" ? slotCountForLocation(doc, locEdit.draft.id) > 0 : false}
      />

      <SlotSheet
        edit={slotEdit}
        locationOptions={doc.zone_loc.map((l) => ({ id: l.id, label: zoneLocDisplayLabel(l) }))}
        onChange={(draft) => slotEdit && setSlotEdit({ ...slotEdit, draft })}
        onDone={() => {
          if (!slotEdit) return;
          const slots = [...doc.slots];
          if (slotEdit.mode === "new") slots.push(slotEdit.draft);
          else slots[slotEdit.index] = slotEdit.draft;
          updateDoc((d) => ({ ...d, slots }));
          setSlotEdit(null);
        }}
        onCancel={() => setSlotEdit(null)}
        onDelete={
          slotEdit?.mode === "edit"
            ? () => {
                updateDoc((d) => ({
                  ...d,
                  slots: d.slots.filter((_, i) => i !== slotEdit!.index),
                }));
                setSlotEdit(null);
              }
            : undefined
        }
      />

      <DevPanelTrigger onOpen={() => openPanel("json")} />
      <DeveloperPanel
        jsonText={editorText}
        onJsonTextChange={syncJson}
        jsonError={jsonError}
        onResetDefaults={resetToServer}
      />
    </>
  );
}

function SectionHeader({
  title,
  hint,
  onAdd,
  disabled,
}: {
  title: string;
  hint: string;
  onAdd: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="section-header-row">
      <div>
        <h3 className="section-title">{title}</h3>
        <p className="section-hint">{hint}</p>
      </div>
      <button
        type="button"
        className="contacts-add-btn"
        aria-label={`Add ${title}`}
        disabled={disabled}
        onPointerDown={(e) => {
          e.preventDefault();
          if (!disabled) onAdd();
        }}
      >
        <Plus size={20} strokeWidth={2.5} />
      </button>
    </div>
  );
}

function EntityTable({
  headers,
  empty,
  rows,
  onEdit,
}: {
  headers: string[];
  empty: string;
  rows: {
    key: string;
    cells: string[];
    index: number;
    inUse?: boolean;
    inUseMsg?: string;
  }[];
  onEdit: (index: number) => void;
}) {
  return (
    <section className="glass-card contacts-list-card section-table">
      {rows.length === 0 ? (
        <p className="contacts-empty">{empty}</p>
      ) : (
        <table className="contacts-table">
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="contacts-row" onDoubleClick={() => onEdit(row.index)}>
                {row.cells.map((c, i) => (
                  <td key={i} className={i === 0 ? "contacts-name" : i === 1 ? "contacts-id" : ""}>
                    {i === 1 ? <code>{c}</code> : c}
                  </td>
                ))}
                <td
                  className="contacts-chevron"
                  title={row.inUse ? row.inUseMsg : undefined}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onEdit(row.index);
                  }}
                >
                  <ChevronRight size={18} strokeWidth={2} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function SlotTypeSheet({
  edit,
  onChange,
  onDone,
  onCancel,
  onDelete,
  deleteBlocked,
}: {
  edit: { mode: "new" | "edit"; draft: SlotType } | null;
  onChange: (d: SlotType) => void;
  onDone: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  deleteBlocked: boolean;
}) {
  if (!edit) return null;
  const d = edit.draft;
  return (
    <ZoneEditSheet
      open
      title={edit.mode === "new" ? "New slot type" : "Edit"}
      canDone={!!d.id.trim() && !!d.name.trim()}
      onDone={onDone}
      onCancel={onCancel}
      footer={
        edit.mode === "edit" && onDelete ? (
          <button
            type="button"
            className="btn btn-destructive contacts-delete-btn"
            disabled={deleteBlocked}
            onPointerDown={() => !deleteBlocked && onDelete()}
          >
            {deleteBlocked ? "Cannot delete — used by zone locations" : "Delete slot type"}
          </button>
        ) : undefined
      }
    >
      <section className="glass-card">
        <Field label="Name" value={d.name} onChange={(name) => onChange({ ...d, name })} />
        <Field label="ID" value={d.id} onChange={(id) => onChange({ ...d, id })} autoCapitalize="none" />
        <div className="settings-row">
          <span className="settings-row-label title">Pattern</span>
          <select
            className="settings-input settings-input-wide"
            value={d.pattern}
            onChange={(e) => {
              const pattern = e.target.value as SlotTypePattern;
              const next = { ...d, pattern };
              if (pattern === "full_day" && !next.config) {
                next.config = { start: "06:00", end: "22:00", rest_after_hours: 6, weight_multiplier: 1 };
              }
              if (pattern === "windowed_slots" && !next.config) {
                next.config = {
                  slots: [{ name: "w1", start: "00:00", end: "12:00", weight_multiplier: 1 }],
                };
              }
              onChange(next);
            }}
          >
            {SLOT_PATTERNS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        {(d.pattern === "full_day" || d.pattern === "windowed_slots") && (
          <div className="settings-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
            <span className="settings-row-label title">Config (JSON)</span>
            <textarea
              className="dev-json-editor"
              style={{ minHeight: 120, width: "100%" }}
              value={JSON.stringify(d.config ?? {}, null, 2)}
              onChange={(e) => {
                try {
                  onChange({ ...d, config: JSON.parse(e.target.value) as Record<string, unknown> });
                } catch {
                  /* keep typing */
                }
              }}
            />
          </div>
        )}
      </section>
    </ZoneEditSheet>
  );
}

function LocationSheet({
  edit,
  typeOptions,
  onChange,
  onDone,
  onCancel,
  onDelete,
  deleteBlocked,
}: {
  edit: { mode: "new" | "edit"; draft: ZoneLoc } | null;
  typeOptions: string[];
  onChange: (d: ZoneLoc) => void;
  onDone: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  deleteBlocked: boolean;
}) {
  if (!edit) return null;
  const d = edit.draft;
  return (
    <ZoneEditSheet
      open
      title={edit.mode === "new" ? "New zone location" : "Edit"}
      canDone={!!d.id.trim() && !!d.type}
      onDone={onDone}
      onCancel={onCancel}
      footer={
        edit.mode === "edit" && onDelete ? (
          <button
            type="button"
            className="btn btn-destructive contacts-delete-btn"
            disabled={deleteBlocked}
            onPointerDown={() => !deleteBlocked && onDelete()}
          >
            {deleteBlocked ? "Cannot delete — used by slots" : "Delete zone location"}
          </button>
        ) : undefined
      }
    >
      <section className="glass-card">
        <Field label="Full name" value={d.full_name} onChange={(full_name) => onChange({ ...d, full_name })} />
        <Field label="Short name" value={d.name} onChange={(name) => onChange({ ...d, name })} autoCapitalize="none" />
        <Field label="ID" value={d.id} onChange={(id) => onChange({ ...d, id })} autoCapitalize="none" />
        <div className="settings-row">
          <span className="settings-row-label title">Slot type</span>
          <select
            className="settings-input settings-input-wide"
            value={d.type}
            onChange={(e) => onChange({ ...d, type: e.target.value })}
          >
            {typeOptions.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </div>
        <Field
          label="Weight"
          value={String(d.weight)}
          inputMode="decimal"
          onChange={(v) => {
            const n = Number(v);
            if (Number.isFinite(n)) onChange({ ...d, weight: n });
          }}
        />
      </section>
    </ZoneEditSheet>
  );
}

function SlotSheet({
  edit,
  locationOptions,
  onChange,
  onDone,
  onCancel,
  onDelete,
}: {
  edit: { mode: "new" | "edit"; draft: ZoneSlot } | null;
  locationOptions: { id: string; label: string }[];
  onChange: (d: ZoneSlot) => void;
  onDone: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  if (!edit) return null;
  const d = edit.draft;
  return (
    <ZoneEditSheet
      open
      title={edit.mode === "new" ? "New slot" : "Edit"}
      canDone={!!d.name.trim() && !!d.location_id}
      onDone={onDone}
      onCancel={onCancel}
      footer={
        edit.mode === "edit" && onDelete ? (
          <button type="button" className="btn btn-destructive contacts-delete-btn" onPointerDown={() => onDelete()}>
            Delete slot
          </button>
        ) : undefined
      }
    >
      <section className="glass-card">
        <Field label="Full name" value={d.full_name} onChange={(full_name) => onChange({ ...d, full_name })} />
        <Field label="Short name" value={d.name} onChange={(name) => onChange({ ...d, name })} autoCapitalize="none" />
        <div className="settings-row">
          <span className="settings-row-label title">Zone location</span>
          <select
            className="settings-input settings-input-wide"
            value={d.location_id}
            onChange={(e) => onChange({ ...d, location_id: e.target.value })}
          >
            {locationOptions.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label} ({l.id})
              </option>
            ))}
          </select>
        </div>
      </section>
    </ZoneEditSheet>
  );
}

function Field({
  label,
  value,
  onChange,
  autoCapitalize = "words",
  inputMode = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoCapitalize?: "off" | "words" | "none";
  inputMode?: "text" | "decimal" | "numeric";
}) {
  return (
    <div className="settings-row">
      <label className="settings-row-label">
        <span className="title">{label}</span>
      </label>
      <input
        className="settings-input settings-input-wide"
        type="text"
        inputMode={inputMode}
        autoCapitalize={autoCapitalize}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

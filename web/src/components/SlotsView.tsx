import { useQuery } from "@tanstack/react-query";
import { Braces, Plus, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { apiGet } from "../api";
import { DecimalNumField } from "./DecimalNumField";
import { useDevPanel } from "../context/AppStateContext";
import { useZonesDocument } from "../context/ZonesDocumentContext";
import { useIsMobile } from "../hooks/useIsMobile";
import { docFromServer, type SoldierType } from "../lib/soldierTypes";
import {
  ALLOWED_SHIFT_HOURS,
  emptyZoneLoc,
  emptySlot,
  emptySlotType,
  normalizeShiftHours,
  zoneLocCountForType,
  slotCountForLocation,
  countEnabledSlots,
  slotDisplayLabel,
  validateShiftHours,
  validateSlotTypePattern,
  PATTERN_WALL_CLOCK_HINT,
  zoneLocDisplayLabel,
  zonesDocToYamlObject,
  DEFAULT_FULL_DAY_CONFIG,
  DEFAULT_FULL_DAY_TEAM_CONFIG,
  DEFAULT_WINDOWED_SLOTS_CONFIG,
  DEFAULT_WINDOWED_WINDOW,
  SLOT_PATTERNS,
  WEEKDAY_NAMES,
  fullDayConfigToRecord,
  fullDayTeamConfigToRecord,
  parseFullDayConfig,
  parseFullDayTeamConfig,
  parseWindowedSlotsConfig,
  windowedSlotsConfigToRecord,
  type FullDayConfig,
  type FullDayTeamConfig,
  type SlotType,
  type SlotTypePattern,
  type WeekdayName,
  type WindowedSlotsConfig,
  type WindowedWindow,
  type ZoneLoc,
  type ZoneSlot,
  type ZonesDoc,
} from "../lib/zones";
import { ContactsRowEditButton } from "./ContactsRowEdit";
import { DevPanelTrigger, DeveloperPanel } from "./DeveloperPanel";
import { ZoneEditSheet } from "./ZoneEditSheet";
import { ZonesYamlToolbar } from "./ZonesYamlToolbar";

function patternLabel(p: string): string {
  return SLOT_PATTERNS.find((x) => x.value === p)?.label ?? p;
}

type CfgResp = { key: string; value: unknown; version: number; updated_at: string };

export function SlotsView() {
  const isMobile = useIsMobile();
  const { openPanel } = useDevPanel();
  const { slotsQ, doc, dirty, loadError, markDirty, replaceDoc, resetToServer, validationError, saveState, saveError } =
    useZonesDocument();

  const typesQ = useQuery({
    queryKey: ["cfg", "soldier_types"],
    queryFn: () => apiGet<CfgResp>("/api/cfg/soldier_types"),
  });
  const soldierTypes = useMemo((): SoldierType[] => {
    if (!typesQ.data) return [];
    return docFromServer(typesQ.data.value).types;
  }, [typesQ.data]);

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

  const slotsStatusLabel =
    saveState === "pending"
      ? "Saving slots…"
      : saveState === "saved" && !dirty
        ? "Slots saved"
        : saveState === "error"
          ? "Slots save failed"
          : dirty
            ? "Slots pending save…"
            : "";

  return (
    <>
      <header className="contacts-toolbar">
        <div className="contacts-toolbar-text">
          <h2 className="contacts-title">Slots & zones</h2>
          <p className="contacts-count">
            {doc.slots_types.length} types · {doc.zone_loc.length} zone locs · {doc.slots.length} slots
            {doc.slots.length > 0 ? ` (${countEnabledSlots(doc)} active)` : ""}
            {slotsStatusLabel ? ` · ${slotsStatusLabel}` : ""}
          </p>
        </div>
        {!isMobile && (
          <div className="contacts-toolbar-actions">
            <button
              type="button"
              className="btn btn-tinted contacts-json-btn"
              onClick={() => openPanel("json")}
            >
              <Braces size={18} strokeWidth={2} />
              <span className="contacts-json-btn-label">JSON</span>
            </button>
          </div>
        )}
      </header>

      <ZonesYamlToolbar disabled={slotsQ.isLoading} doc={doc} onImport={(d) => replaceDoc(d)} />

      <p className="contacts-hint contacts-list-hint">
        Double-click a row to edit, or tap the › button. Edits save automatically.
      </p>

      {loadError && <div className="err glass-card">{loadError}</div>}
      {(saveState === "error" || jsonError) && (
        <p className="msg-err">{saveState === "error" ? saveError : jsonError}</p>
      )}

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

      <details className="soldiers-section-accordion" open>
        <summary>Slot types</summary>
        <SectionAddButton
          label="slot type"
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
      </details>

      <details className="soldiers-section-accordion" open>
        <summary>Zone locations</summary>
        <SectionAddButton
          label="zone location"
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
      </details>

      <details className="soldiers-section-accordion" open>
        <summary>Slots</summary>
        <SectionAddButton
          label="slot"
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
          headers={["Name", "Short", "Zone loc", "Status", ""]}
          empty={doc.zone_loc.length === 0 ? "Add zone locations first" : "Add a slot"}
          rows={doc.slots.map((sl, index) => ({
            key: `${sl.location_id}-${sl.name}-${index}`,
            cells: [slotDisplayLabel(sl), sl.name, sl.location_id, sl.disabled ? "Off" : "Active"],
            index,
            inUse: false,
            rowClassName: sl.disabled ? "slots-row-disabled" : undefined,
          }))}
          onEdit={(index) => setSlotEdit({ mode: "edit", index, draft: { ...doc.slots[index] } })}
        />
      </details>

      {slotsQ.data && (
        <p className="meta-line">
          Version {slotsQ.data.version} · updated {new Date(slotsQ.data.updated_at).toLocaleString()}
        </p>
      )}

      <SlotTypeSheet
        soldierTypes={soldierTypes}
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
        doc={doc}
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

      {!isMobile && <DevPanelTrigger onOpen={() => openPanel("json")} />}
      <DeveloperPanel
        jsonText={editorText}
        onJsonTextChange={syncJson}
        jsonError={jsonError}
        onResetDefaults={resetToServer}
      />
    </>
  );
}

function SectionAddButton({
  label,
  onAdd,
  disabled,
}: {
  label: string;
  onAdd: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="section-add-row">
      <button
        type="button"
        className="contacts-add-btn"
        aria-label={`Add ${label}`}
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
    rowClassName?: string;
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
              <tr
                key={row.key}
                className={["contacts-row", row.rowClassName].filter(Boolean).join(" ")}
                onDoubleClick={() => onEdit(row.index)}
              >
                {row.cells.map((c, i) => (
                  <td
                    key={i}
                    className={
                      i === 0
                        ? "contacts-name"
                        : i === 1
                          ? "contacts-id"
                          : headers[i] === "Status"
                            ? "slots-status-cell"
                            : ""
                    }
                  >
                    {i === 1 ? <code>{c}</code> : c}
                  </td>
                ))}
                <ContactsRowEditButton onEdit={() => onEdit(row.index)} />
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function SlotTypeSheet({
  soldierTypes,
  edit,
  onChange,
  onDone,
  onCancel,
  onDelete,
  deleteBlocked,
}: {
  soldierTypes: SoldierType[];
  edit: { mode: "new" | "edit"; draft: SlotType } | null;
  onChange: (d: SlotType) => void;
  onDone: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  deleteBlocked: boolean;
}) {
  if (!edit) return null;
  const d = edit.draft;
  const patternError = validateSlotTypePattern(d);
  return (
    <ZoneEditSheet
      open
      title={edit.mode === "new" ? "New slot type" : "Edit"}
      canDone={!!d.id.trim() && !!d.name.trim() && !patternError}
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
                next.config = fullDayConfigToRecord(DEFAULT_FULL_DAY_CONFIG);
              }
              if (pattern === "full_day_team" && !next.config) {
                next.config = fullDayTeamConfigToRecord(DEFAULT_FULL_DAY_TEAM_CONFIG);
              }
              if (pattern === "windowed_slots") {
                if (!next.config) {
                  next.config = windowedSlotsConfigToRecord(DEFAULT_WINDOWED_SLOTS_CONFIG);
                }
                if (next.rest_after_hours == null) next.rest_after_hours = 6;
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
        <DisabledWeekdaysField
          disabled={d.disabled_weekdays ?? []}
          onChange={(disabled_weekdays) =>
            onChange({
              ...d,
              disabled_weekdays: disabled_weekdays.length > 0 ? disabled_weekdays : undefined,
            })
          }
        />
        <ExcludedSoldierTypesField
          soldierTypes={soldierTypes}
          exclude={d.exclude ?? []}
          onChange={(exclude) =>
            onChange({
              ...d,
              exclude: exclude.length > 0 ? exclude : undefined,
            })
          }
        />
        {d.pattern === "full_day" && (
          <FullDayConfigFields
            showHeadcount
            config={parseFullDayConfig(d.config)}
            onChange={(cfg) => onChange({ ...d, config: fullDayConfigToRecord(cfg) })}
          />
        )}
        {d.pattern === "full_day_team" && (
          <FullDayTeamConfigFields
            soldierTypes={soldierTypes}
            config={parseFullDayTeamConfig(d.config)}
            onChange={(cfg) => onChange({ ...d, config: fullDayTeamConfigToRecord(cfg) })}
          />
        )}
        {d.pattern === "windowed_slots" && (
          <WindowedSlotsConfigFields
            config={parseWindowedSlotsConfig(d.config)}
            restAfterHours={d.rest_after_hours ?? 6}
            fullDayShift={d.full_day_shift ?? 1}
            onChange={(cfg) => onChange({ ...d, config: windowedSlotsConfigToRecord(cfg) })}
            onRestAfterHours={(rest_after_hours) => onChange({ ...d, rest_after_hours })}
            onFullDayShift={(full_day_shift) => onChange({ ...d, full_day_shift })}
          />
        )}
        {patternError && (
          <p className="err slot-type-pattern-err" role="alert">
            {patternError}
          </p>
        )}
        {(d.pattern === "full_day" || d.pattern === "full_day_team" || d.pattern === "windowed_slots") &&
          !patternError && (
          <p className="contacts-hint slot-type-grid-hint">{PATTERN_WALL_CLOCK_HINT}</p>
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
        <DecimalNumField label="Weight" value={d.weight} onChange={(weight) => onChange({ ...d, weight })} />
      </section>
    </ZoneEditSheet>
  );
}

function slotPatternForLocation(doc: ZonesDoc, locationId: string): SlotTypePattern | null {
  const loc = doc.zone_loc.find((l) => l.id === locationId);
  if (!loc) return null;
  return doc.slots_types.find((t) => t.id === loc.type)?.pattern ?? null;
}

function SlotSheet({
  edit,
  doc,
  locationOptions,
  onChange,
  onDone,
  onCancel,
  onDelete,
}: {
  edit: { mode: "new" | "edit"; draft: ZoneSlot } | null;
  doc: ZonesDoc;
  locationOptions: { id: string; label: string }[];
  onChange: (d: ZoneSlot) => void;
  onDone: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  if (!edit) return null;
  const d = edit.draft;
  const locPattern = slotPatternForLocation(doc, d.location_id);
  const showSoldiersRequired = locPattern === "rotating";
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
        {showSoldiersRequired && (
          <>
            <p className="contacts-hint">Concurrent guards for this slot row (default 1).</p>
            <NumField
              label="Soldiers required"
              value={d.soldiers_required ?? 1}
              onChange={(soldiers_required) => onChange({ ...d, soldiers_required })}
            />
          </>
        )}
        <div className="settings-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
          <label className="slot-weekday-check">
            <input
              type="checkbox"
              checked={!!d.disabled}
              onChange={(e) =>
                onChange({
                  ...d,
                  disabled: e.target.checked ? true : undefined,
                })
              }
            />
            <span>
              <span className="title">Disabled</span>
              <span className="hint"> — excluded from scheduling (kept in config for testing)</span>
            </span>
          </label>
        </div>
      </section>
    </ZoneEditSheet>
  );
}

function ExcludedSoldierTypesField({
  soldierTypes,
  exclude,
  onChange,
}: {
  soldierTypes: SoldierType[];
  exclude: string[];
  onChange: (codes: string[]) => void;
}) {
  const catalogCodes = new Set(soldierTypes.map((t) => t.code));
  const orphanCodes = exclude.filter((c) => !catalogCodes.has(c));
  const toggle = (code: string) => {
    const set = new Set(exclude);
    if (set.has(code)) set.delete(code);
    else set.add(code);
    const ordered = [
      ...soldierTypes.map((t) => t.code).filter((c) => set.has(c)),
      ...[...set].filter((c) => !catalogCodes.has(c)),
    ];
    onChange(ordered);
  };
  return (
    <div className="settings-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
      <span className="settings-row-label title">Excluded soldier types</span>
      <span className="hint">
        Checked types cannot fill slots using this slot type (requires roster with type_code).
      </span>
      {soldierTypes.length === 0 ? (
        <>
          <span className="hint">Configure soldier types first to pick from the catalog.</span>
          {orphanCodes.length > 0 ? (
            <div className="slot-weekday-grid">
              {orphanCodes.map((code) => (
                <label key={`orphan-${code}`} className="slot-weekday-check">
                  <input type="checkbox" checked disabled />
                  <span>
                    {code} <span className="hint">(not in catalog)</span>
                  </span>
                </label>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div className="slot-weekday-grid">
          {soldierTypes.map((t) => (
            <label key={t.code} className="slot-weekday-check">
              <input
                type="checkbox"
                checked={exclude.includes(t.code)}
                onChange={() => toggle(t.code)}
              />
              <span>
                {t.code}
                {t.label ? ` — ${t.label}` : ""}
              </span>
            </label>
          ))}
          {orphanCodes.map((code) => (
            <label key={`orphan-${code}`} className="slot-weekday-check">
              <input type="checkbox" checked disabled />
              <span>
                {code} <span className="hint">(not in catalog)</span>
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function DisabledWeekdaysField({
  disabled,
  onChange,
}: {
  disabled: WeekdayName[];
  onChange: (days: WeekdayName[]) => void;
}) {
  const toggle = (day: WeekdayName) => {
    const set = new Set(disabled);
    if (set.has(day)) set.delete(day);
    else set.add(day);
    onChange(WEEKDAY_NAMES.filter((d) => set.has(d)));
  };
  return (
    <div className="settings-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
      <span className="settings-row-label title">Off on (weekdays)</span>
      <span className="hint">No assignments on checked days (uses plan anchor calendar)</span>
      <div className="slot-weekday-grid">
        {WEEKDAY_NAMES.map((day) => (
          <label key={day} className="slot-weekday-check">
            <input type="checkbox" checked={disabled.includes(day)} onChange={() => toggle(day)} />
            <span>{day.slice(0, 3)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function FullDayConfigFields({
  config,
  onChange,
  showHeadcount = false,
}: {
  config: FullDayConfig;
  onChange: (cfg: FullDayConfig) => void;
  showHeadcount?: boolean;
}) {
  return (
    <>
      <Field
        label="Start"
        hint={PATTERN_WALL_CLOCK_HINT}
        value={config.start}
        autoCapitalize="none"
        onChange={(start) => onChange({ ...config, start })}
      />
      <Field
        label="End"
        hint={PATTERN_WALL_CLOCK_HINT}
        value={config.end}
        autoCapitalize="none"
        onChange={(end) => onChange({ ...config, end })}
      />
      <NumField
        label="Rest after (hours)"
        value={config.rest_after_hours}
        onChange={(rest_after_hours) => onChange({ ...config, rest_after_hours })}
      />
      <DecimalNumField
        label="Weight multiplier"
        hint="e.g. 0.3, 1.1"
        value={config.weight_multiplier}
        onChange={(weight_multiplier) => onChange({ ...config, weight_multiplier })}
      />
      <DecimalNumField
        label="Hours factor"
        hint="Credited duty fraction for fairness (e.g. 0.5); busy span unchanged"
        value={config.hours_factor}
        onChange={(hours_factor) => onChange({ ...config, hours_factor })}
      />
      {showHeadcount && (
        <NumField
          label="Headcount"
          hint="Soldiers assigned to this post per day"
          value={config.headcount}
          onChange={(headcount) => onChange({ ...config, headcount: Math.max(1, Math.round(headcount)) })}
        />
      )}
    </>
  );
}

function TypeQuotasEditor({
  headcount,
  quotas,
  soldierTypes,
  onChange,
}: {
  headcount: number;
  quotas: Record<string, number>;
  soldierTypes: SoldierType[];
  onChange: (type_quotas: Record<string, number>) => void;
}) {
  const [customCode, setCustomCode] = useState("");

  const rows = useMemo(() => {
    const codes = new Set(soldierTypes.map((t) => t.code.trim()).filter(Boolean));
    for (const k of Object.keys(quotas)) codes.add(k);
    return [...codes].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [quotas, soldierTypes]);

  const sum = useMemo(() => Object.values(quotas).reduce((a, b) => a + b, 0), [quotas]);
  const over = sum > headcount;

  const setQuota = (code: string, raw: number) => {
    const next = { ...quotas };
    const n = Math.round(raw);
    if (!Number.isFinite(n) || n < 1) delete next[code];
    else next[code] = Math.min(n, headcount);
    onChange(next);
  };

  const addCustomCode = () => {
    const code = customCode.trim().toUpperCase();
    if (!code) return;
    onChange({ ...quotas, [code]: quotas[code] ?? 1 });
    setCustomCode("");
  };

  return (
    <div className="type-quotas-editor">
      <p className="settings-row-label title">Type quotas (minimums)</p>
      <p className="contacts-hint">
        Minimum soldiers of each rank/role on this post (e.g. A:1). Codes come from Soldiers → Types. Sum must
        not exceed headcount ({headcount}).
      </p>
      {soldierTypes.length === 0 && rows.length === 0 && (
        <p className="contacts-hint">No soldier types yet — add types under Soldiers, or add a custom code below.</p>
      )}
      {rows.length > 0 && (
        <table className="contacts-table type-quotas-table">
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Label</th>
              <th scope="col">Min</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((code) => {
              const label = soldierTypes.find((t) => t.code === code)?.label ?? "";
              return (
                <tr key={code}>
                  <td className="contacts-id">
                    <code>{code}</code>
                  </td>
                  <td className="contacts-name">{label || "—"}</td>
                  <td>
                    <input
                      className="settings-input type-quotas-min-input"
                      type="number"
                      min={0}
                      max={headcount}
                      step={1}
                      value={quotas[code] ?? 0}
                      aria-label={`Minimum ${code}`}
                      onChange={(e) => setQuota(code, Number(e.target.value))}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="type-quotas-add-row">
        <input
          className="settings-input"
          type="text"
          placeholder="Custom code (e.g. A)"
          value={customCode}
          maxLength={4}
          autoCapitalize="characters"
          autoComplete="off"
          onChange={(e) => setCustomCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCustomCode();
            }
          }}
        />
        <button type="button" className="btn btn-tinted" onPointerDown={() => addCustomCode()}>
          Add type
        </button>
      </div>
      <p className={`contacts-hint${over ? " err" : ""}`} role={over ? "alert" : undefined}>
        Quota total: {sum} / {headcount} headcount
        {over ? " — reduce quotas or raise headcount" : ""}
      </p>
    </div>
  );
}

function FullDayTeamConfigFields({
  soldierTypes,
  config,
  onChange,
}: {
  soldierTypes: SoldierType[];
  config: FullDayTeamConfig;
  onChange: (cfg: FullDayTeamConfig) => void;
}) {
  return (
    <>
      <FullDayConfigFields
        showHeadcount
        config={config}
        onChange={(base) => onChange({ ...config, ...base })}
      />
      <TypeQuotasEditor
        headcount={config.headcount}
        quotas={config.type_quotas}
        soldierTypes={soldierTypes}
        onChange={(type_quotas) => onChange({ ...config, type_quotas })}
      />
      <label className="settings-row settings-checkbox-row">
        <input
          type="checkbox"
          checked={Boolean(config.pin_platoon)}
          onChange={(e) => {
            const pin_platoon = e.target.checked;
            onChange(pin_platoon ? { ...config, pin_platoon: true } : { ...config, pin_platoon: undefined });
          }}
        />
        <span className="settings-row-label">Pin platoon (prefer one platoon per team shift)</span>
      </label>
      <p className="contacts-hint">
        Tries to staff the whole team from one platoon (fittest first). If a quota seat cannot be filled inside that
        platoon, soldiers may be taken from other platoons; type minimums are always enforced.
      </p>
    </>
  );
}

function WindowedSlotsConfigFields({
  config,
  restAfterHours,
  fullDayShift,
  onChange,
  onRestAfterHours,
  onFullDayShift,
}: {
  config: WindowedSlotsConfig;
  restAfterHours: number;
  fullDayShift: number;
  onChange: (cfg: WindowedSlotsConfig) => void;
  onRestAfterHours: (h: number) => void;
  onFullDayShift: (n: number) => void;
}) {
  const updateWindow = (index: number, patch: Partial<WindowedWindow>) => {
    const slots = config.slots.map((w, i) => (i === index ? { ...w, ...patch } : w));
    onChange({ ...config, slots });
  };

  const removeWindow = (index: number) => {
    if (config.slots.length <= 1) return;
    onChange({ ...config, slots: config.slots.filter((_, i) => i !== index) });
  };

  const addWindow = () => {
    const n = config.slots.length + 1;
    onChange({
      ...config,
      slots: [
        ...config.slots,
        { ...DEFAULT_WINDOWED_WINDOW, name: `w${n}`, start: "00:00", end: "12:00" },
      ],
    });
  };

  return (
    <>
      <NumField label="Rest after (hours)" value={restAfterHours} onChange={onRestAfterHours} />
      <NumField label="Full day shift" value={fullDayShift} onChange={onFullDayShift} />
      <NumField
        label="Headcount"
        hint="Soldiers assigned to this post per day (after best window is chosen)"
        value={config.headcount}
        onChange={(headcount) => onChange({ ...config, headcount: Math.max(1, Math.round(headcount)) })}
      />
      <div className="slot-type-windows">
        <div className="slot-type-windows-header">
          <span className="settings-row-label title">Windows</span>
          <button type="button" className="btn btn-tinted slot-type-add-window" onPointerDown={() => addWindow()}>
            Add window
          </button>
        </div>
        {config.slots.map((w, index) => (
          <div key={index} className="slot-type-window-card">
            <div className="slot-type-window-card-header">
              <span className="slot-type-window-card-title">Window {index + 1}</span>
              {config.slots.length > 1 && (
                <button
                  type="button"
                  className="slot-type-remove-window"
                  aria-label={`Remove window ${index + 1}`}
                  onPointerDown={() => removeWindow(index)}
                >
                  <Trash2 size={18} strokeWidth={2} />
                </button>
              )}
            </div>
            <Field label="Name" value={w.name} autoCapitalize="none" onChange={(name) => updateWindow(index, { name })} />
            <Field
              label="Start"
              hint={PATTERN_WALL_CLOCK_HINT}
              value={w.start}
              autoCapitalize="none"
              onChange={(start) => updateWindow(index, { start })}
            />
            <Field
              label="End"
              hint={PATTERN_WALL_CLOCK_HINT}
              value={w.end}
              autoCapitalize="none"
              onChange={(end) => updateWindow(index, { end })}
            />
            <DecimalNumField
              label="Weight multiplier"
              hint="e.g. 0.3, 1.1"
              value={w.weight_multiplier}
              onChange={(weight_multiplier) => updateWindow(index, { weight_multiplier })}
            />
          </div>
        ))}
      </div>
    </>
  );
}

function NumField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <Field
      label={label}
      hint={hint}
      value={String(value)}
      inputMode="decimal"
      onChange={(v) => {
        const n = Number(v);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  autoCapitalize = "words",
  inputMode = "text",
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  autoCapitalize?: "off" | "words" | "none";
  inputMode?: "text" | "decimal" | "numeric";
}) {
  return (
    <div className="settings-row">
      <label className="settings-row-label">
        <span className="title">{label}</span>
        {hint ? <span className="hint">{hint}</span> : null}
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

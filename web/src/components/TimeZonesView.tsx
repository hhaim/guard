import { Braces, Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { DecimalNumField } from "./DecimalNumField";
import { useDevPanel } from "../context/AppStateContext";
import { useZonesDocument } from "../context/ZonesDocumentContext";
import {
  emptyTimeBand,
  formatTimeBandBound,
  timeBandBoundSortKey,
  zonesDocToYamlObject,
  type TimeBand,
} from "../lib/zones";
import { ContactsRowEditButton } from "./ContactsRowEdit";
import { DevPanelTrigger, DeveloperPanel } from "./DeveloperPanel";
import { ZoneEditSheet } from "./ZoneEditSheet";
import { ZonesYamlToolbar } from "./ZonesYamlToolbar";

export function TimeZonesView() {
  const { openPanel } = useDevPanel();
  const { slotsQ, doc, dirty, loadError, markDirty, replaceDoc, resetToServer, validationError, saveState, saveError } =
    useZonesDocument();

  const [jsonOverride, setJsonOverride] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ mode: "new" | "edit"; index: number; draft: TimeBand } | null>(null);

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
        const parsed = JSON.parse(text) as { time_zones?: TimeBand[] };
        markDirty({ ...doc, time_zones: parsed.time_zones ?? doc.time_zones });
      } catch {
        /* invalid */
      }
    },
    [doc, markDirty]
  );

  const sorted = useMemo(() => {
    if (!doc) return [];
    return doc.time_zones
      .map((t, index) => ({ t, index }))
      .sort((a, b) => timeBandBoundSortKey(a.t.from_hour) - timeBandBoundSortKey(b.t.from_hour));
  }, [doc]);

  if (!doc) {
    return slotsQ.isLoading ? (
      <p className="meta-line">Loading time zones…</p>
    ) : (
      <p className="err">Failed to load zones.</p>
    );
  }

  const tzStatusLabel =
    saveState === "pending"
      ? "Saving time zones…"
      : saveState === "saved" && !dirty
        ? "Time zones saved"
        : saveState === "error"
          ? "Time zones save failed"
          : dirty
            ? "Time zones pending save…"
            : "";

  return (
    <>
      <header className="contacts-toolbar">
        <div className="contacts-toolbar-text">
          <h2 className="contacts-title">Time zones</h2>
          <p className="contacts-count">
            Fairness bands (YAML) · {doc.time_zones.length} zones
            {tzStatusLabel ? ` · ${tzStatusLabel}` : ""}
          </p>
        </div>
        <div className="contacts-toolbar-actions">
          <button
            type="button"
            className="btn btn-tinted contacts-json-btn"
            onClick={() => openPanel("json")}
          >
            <Braces size={18} strokeWidth={2} />
            <span className="contacts-json-btn-label">JSON</span>
          </button>
          <button
            type="button"
            className="contacts-add-btn"
            aria-label="Add time zone"
            onPointerDown={(e) => {
              e.preventDefault();
              setEdit({
                mode: "new",
                index: doc.time_zones.length,
                draft: emptyTimeBand(doc.time_zones.length),
              });
            }}
          >
            <Plus size={22} strokeWidth={2.5} />
          </button>
        </div>
      </header>

      <ZonesYamlToolbar disabled={slotsQ.isLoading} doc={doc} onImport={(d) => replaceDoc(d)} />

      {(saveState === "error" || jsonError) && (
        <p className="msg-err">{saveState === "error" ? saveError : jsonError}</p>
      )}

      {loadError && <div className="err glass-card">{loadError}</div>}

      <p className="contacts-hint" style={{ marginTop: 0 }}>
        Piecewise fairness weights by hour (same as <code>time_zones</code> in zones YAML). Stored with slots config.
        Edits save automatically.
      </p>

      <section className="glass-card contacts-list-card">
        {sorted.length === 0 ? (
          <p className="contacts-empty">No time zones. Tap + to add.</p>
        ) : (
          <table className="contacts-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">ID</th>
                <th scope="col">Hours</th>
                <th scope="col">Weight</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ t, index }) => (
                <tr
                  key={t.id}
                  className="contacts-row"
                  onDoubleClick={() => setEdit({ mode: "edit", index, draft: { ...t } })}
                >
                  <td className="contacts-name">{t.name}</td>
                  <td className="contacts-id">
                    <code>{t.id}</code>
                  </td>
                  <td>
                    {formatTimeBandBound(t.from_hour)} – {formatTimeBandBound(t.to_hour)}
                  </td>
                  <td>{t.weight}</td>
                  <ContactsRowEditButton
                    label={`Edit ${t.name}`}
                    onEdit={() => setEdit({ mode: "edit", index, draft: { ...t } })}
                  />
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="contacts-hint">Double-click a row to edit, or tap the › button</p>

      {slotsQ.data && (
        <p className="meta-line">
          Slots config v{slotsQ.data.version} · updated {new Date(slotsQ.data.updated_at).toLocaleString()}
        </p>
      )}

      {edit && (
        <ZoneEditSheet
          open
          title={edit.mode === "new" ? "New time zone" : "Edit"}
          canDone={!!edit.draft.id.trim()}
          onDone={() => {
            const bands = [...doc.time_zones];
            if (edit.mode === "new") bands.push(edit.draft);
            else bands[edit.index] = edit.draft;
            markDirty({ ...doc, time_zones: bands });
            setEdit(null);
          }}
          onCancel={() => setEdit(null)}
          footer={
            edit.mode === "edit" ? (
              <button
                type="button"
                className="btn btn-destructive contacts-delete-btn"
                onPointerDown={() => {
                  markDirty({
                    ...doc,
                    time_zones: doc.time_zones.filter((_, i) => i !== edit.index),
                  });
                  setEdit(null);
                }}
              >
                Delete time zone
              </button>
            ) : undefined
          }
        >
          <section className="glass-card">
            <div className="settings-row">
              <label className="settings-row-label">
                <span className="title">Name</span>
              </label>
              <input
                className="settings-input settings-input-wide"
                value={edit.draft.name}
                onChange={(e) => setEdit({ ...edit, draft: { ...edit.draft, name: e.target.value } })}
              />
            </div>
            <div className="settings-row">
              <label className="settings-row-label">
                <span className="title">ID</span>
              </label>
              <input
                className="settings-input settings-input-wide"
                autoCapitalize="off"
                value={edit.draft.id}
                onChange={(e) => setEdit({ ...edit, draft: { ...edit.draft, id: e.target.value } })}
              />
            </div>
            <div className="settings-row">
              <label className="settings-row-label">
                <span className="title">From hour</span>
                <span className="hint">0–23 inclusive</span>
              </label>
              <input
                className="settings-input"
                inputMode="numeric"
                value={String(edit.draft.from_hour)}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) setEdit({ ...edit, draft: { ...edit.draft, from_hour: n } });
                }}
              />
            </div>
            <div className="settings-row">
              <label className="settings-row-label">
                <span className="title">To hour</span>
              </label>
              <input
                className="settings-input"
                inputMode="numeric"
                value={String(edit.draft.to_hour)}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) setEdit({ ...edit, draft: { ...edit.draft, to_hour: n } });
                }}
              />
            </div>
            <DecimalNumField
              label="Weight"
              value={edit.draft.weight}
              inputClassName="settings-input"
              onChange={(weight) => setEdit({ ...edit, draft: { ...edit.draft, weight } })}
            />
          </section>
        </ZoneEditSheet>
      )}

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

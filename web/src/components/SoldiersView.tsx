import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Braces, Download, Plus, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPut } from "../api";
import { useDevPanel } from "../context/AppStateContext";
import { formatApiError } from "../lib/apiError";
import {
  deriveJsonFromDoc,
  docFromServer,
  emptySoldier,
  parseDocFromJson,
  soldierInitials,
  validateDoc,
  type Soldier,
  type SoldiersDoc,
} from "../lib/soldiers";
import { downloadText, pickTextFile } from "../lib/fileIo";
import { ContactsRowEditButton } from "./ContactsRowEdit";
import { DevPanelTrigger, DeveloperPanel } from "./DeveloperPanel";
import { SoldierEditorSheet } from "./SoldierEditorSheet";
import { SoldiersStatusBoard } from "./SoldiersStatusBoard";

type CfgResp = { key: string; value: unknown; version: number; updated_at: string };

const ROSTER_AUTOSAVE_MS = 600;

export function SoldiersView() {
  const qc = useQueryClient();
  const { openPanel } = useDevPanel();

  const soldiersQ = useQuery({
    queryKey: ["cfg", "soldiers"],
    queryFn: () => apiGet<CfgResp>("/api/cfg/soldiers"),
  });

  const [doc, setDoc] = useState<SoldiersDoc>({ soldiers: [] });
  const [jsonOverride, setJsonOverride] = useState<string | null>(null);
  const [version, setVersion] = useState<number | undefined>();
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "pending" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const versionRef = useRef(version);
  versionRef.current = version;
  const skipAutosaveRef = useRef(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"edit" | "new">("edit");
  const [editorIndex, setEditorIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<Soldier | null>(null);

  useEffect(() => {
    if (!soldiersQ.data) return;
    const next = docFromServer(soldiersQ.data.value);
    skipAutosaveRef.current = true;
    setDoc(next);
    setJsonOverride(null);
    setVersion(soldiersQ.data.version);
    setDirty(false);
    setSaveState("idle");
    setSaveError(null);
  }, [soldiersQ.data]);

  const liveJson = useMemo(() => {
    if (jsonOverride != null) {
      try {
        return deriveJsonFromDoc(parseDocFromJson(JSON.parse(jsonOverride)));
      } catch {
        return deriveJsonFromDoc(doc);
      }
    }
    return deriveJsonFromDoc(doc);
  }, [doc, jsonOverride]);

  const jsonError = useMemo(() => {
    if (jsonOverride == null) return validateDoc(doc);
    try {
      const parsed = parseDocFromJson(JSON.parse(jsonOverride));
      return validateDoc(parsed);
    } catch (e) {
      return e instanceof Error ? e.message : "Invalid JSON";
    }
  }, [jsonOverride, doc]);

  const editorText = jsonOverride ?? JSON.stringify(liveJson, null, 2);

  const sortedRows = useMemo(() => {
    const rows = doc.soldiers.map((s, index) => ({ s, index }));
    return rows.sort((a, b) => {
      const na = a.s.full_name.trim() || a.s.id;
      const nb = b.s.full_name.trim() || b.s.id;
      return na.localeCompare(nb, undefined, { sensitivity: "base" });
    });
  }, [doc.soldiers]);

  const saveRosterM = useMutation({
    mutationFn: async (payload: SoldiersDoc) => {
      const err = validateDoc(payload);
      if (err) throw new Error(err);
      const res = (await apiPut("/api/cfg/soldiers", {
        value: deriveJsonFromDoc(payload),
        expected_version: versionRef.current ?? 0,
      })) as { version?: number };
      return res;
    },
    onMutate: () => {
      setSaveState("pending");
      setSaveError(null);
    },
    onSuccess: (res) => {
      if (res?.version != null) versionRef.current = res.version;
      setVersion(res?.version);
      setDirty(false);
      setSaveState("saved");
      void qc.invalidateQueries({ queryKey: ["cfg", "soldiers"] });
      void qc.invalidateQueries({ queryKey: ["plan", "preview-availability"] });
    },
    onError: (e: Error) => {
      setSaveState("error");
      setSaveError(formatApiError(e));
    },
  });

  const docForSave = useMemo((): SoldiersDoc | null => {
    if (jsonOverride != null) {
      try {
        return parseDocFromJson(JSON.parse(jsonOverride));
      } catch {
        return null;
      }
    }
    return doc;
  }, [doc, jsonOverride]);

  useEffect(() => {
    if (skipAutosaveRef.current) {
      skipAutosaveRef.current = false;
      return;
    }
    if (!dirty || jsonError || !docForSave) return;
    const timer = window.setTimeout(() => {
      saveRosterM.mutate(docForSave);
    }, ROSTER_AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- saveRosterM is stable enough; debounce on doc only
  }, [dirty, jsonError, docForSave]);

  const syncJsonToForm = useCallback((text: string) => {
    setJsonOverride(text);
    try {
      const parsed = parseDocFromJson(JSON.parse(text));
      setDoc(parsed);
      setDirty(true);
      setSaveState("idle");
    } catch {
      /* keep draft */
    }
  }, []);

  const markDirty = useCallback((next: SoldiersDoc) => {
    setJsonOverride(null);
    setDoc(next);
    setDirty(true);
    setSaveState("idle");
  }, []);

  const openEditor = useCallback((index: number, mode: "edit" | "new" = "edit") => {
    setEditorMode(mode);
    setEditorIndex(index);
    setDraft({ ...doc.soldiers[index] });
    setEditorOpen(true);
  }, [doc.soldiers]);

  const openNew = useCallback(() => {
    const next = emptySoldier(doc.soldiers);
    setEditorMode("new");
    setEditorIndex(doc.soldiers.length);
    setDraft(next);
    setEditorOpen(true);
  }, [doc.soldiers.length]);

  const commitEditor = useCallback(() => {
    if (!draft || editorIndex == null) return;
    const soldiers = [...doc.soldiers];
    if (editorMode === "new") {
      soldiers.push({ ...draft });
    } else {
      soldiers[editorIndex] = { ...draft };
    }
    markDirty({ ...doc, soldiers });
    setEditorOpen(false);
    setDraft(null);
    setEditorIndex(null);
  }, [draft, doc, editorIndex, editorMode, markDirty]);

  const deleteFromEditor = useCallback(() => {
    if (editorIndex == null || editorMode === "new") return;
    const soldiers = doc.soldiers.filter((_, i) => i !== editorIndex);
    markDirty({ ...doc, soldiers });
    setEditorOpen(false);
    setDraft(null);
    setEditorIndex(null);
  }, [doc, editorIndex, editorMode, markDirty]);

  const resetToServer = useCallback(() => {
    if (!soldiersQ.data) return;
    skipAutosaveRef.current = true;
    const next = docFromServer(soldiersQ.data.value);
    setDoc(next);
    setJsonOverride(null);
    setVersion(soldiersQ.data.version);
    setDirty(false);
    setSaveState("idle");
    setSaveError(null);
  }, [soldiersQ.data]);

  const rosterStatusLabel =
    saveState === "pending"
      ? "Saving roster…"
      : saveState === "saved"
        ? "Roster saved"
        : saveState === "error"
          ? "Roster save failed"
          : dirty
            ? "Roster pending save…"
            : "";

  return (
    <>
      <header className="contacts-toolbar">
        <div className="contacts-toolbar-text">
          <h2 className="contacts-title">Soldiers</h2>
          <p className="contacts-count">
            {sortedRows.length} {sortedRows.length === 1 ? "soldier" : "soldiers"}
            {rosterStatusLabel ? ` · ${rosterStatusLabel}` : ""}
          </p>
        </div>
        <div className="contacts-toolbar-actions">
          <button
            type="button"
            className="btn btn-tinted contacts-json-btn"
            aria-label="Show JSON debug panel"
            onClick={() => openPanel("json")}
          >
            <Braces size={18} strokeWidth={2} />
            <span className="contacts-json-btn-label">JSON</span>
          </button>
          <button
            type="button"
            className="btn btn-tinted contacts-json-btn"
            aria-label="Export soldiers JSON"
            onClick={() =>
              downloadText(
                `soldiers-${new Date().toISOString().slice(0, 10)}.json`,
                JSON.stringify(liveJson, null, 2),
                "application/json"
              )
            }
          >
            <Download size={18} strokeWidth={2} />
            <span className="contacts-json-btn-label">Export</span>
          </button>
          <button
            type="button"
            className="btn btn-tinted contacts-json-btn"
            aria-label="Import soldiers JSON"
            onClick={async () => {
              try {
                const text = await pickTextFile(".json,application/json");
                if (!confirm("Import soldiers JSON? This replaces the current list.")) return;
                const parsed = parseDocFromJson(JSON.parse(text));
                setDoc(parsed);
                setJsonOverride(null);
                setDirty(true);
                setSaveState("idle");
              } catch (err) {
                alert(err instanceof Error ? err.message : "Import failed");
              }
            }}
          >
            <Upload size={18} strokeWidth={2} />
            <span className="contacts-json-btn-label">Import</span>
          </button>
        </div>
      </header>

      <SoldiersStatusBoard soldiers={doc.soldiers} />

      <section className="soldiers-roster-section" aria-labelledby="soldiers-roster-heading">
        <header className="soldiers-roster-header">
          <div>
            <h3 id="soldiers-roster-heading" className="contacts-title">
              Roster
            </h3>
            <p className="contacts-count">Identity only — edits save automatically.</p>
          </div>
          <button
            type="button"
            className="contacts-add-btn"
            aria-label="Add soldier"
            onPointerDown={(e) => {
              e.preventDefault();
              openNew();
            }}
          >
            <Plus size={22} strokeWidth={2.5} />
          </button>
        </header>

        <div className="glass-card contacts-list-card">
          {soldiersQ.isLoading && <p className="contacts-empty">Loading…</p>}
          {!soldiersQ.isLoading && sortedRows.length === 0 && (
            <p className="contacts-empty">No soldiers yet. Tap + to add one.</p>
          )}
          <table className="contacts-table">
            <thead>
              <tr>
                <th className="contacts-th-avatar" scope="col" />
                <th scope="col">Name</th>
                <th scope="col">ID</th>
                <th className="contacts-th-chevron" scope="col" />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(({ s, index }) => (
                <tr
                  key={`${s.id}-${index}`}
                  className="contacts-row"
                  onDoubleClick={() => openEditor(index)}
                >
                  <td>
                    <div className="contacts-avatar" aria-hidden>
                      {soldierInitials(s)}
                    </div>
                  </td>
                  <td className="contacts-name">{s.full_name.trim() || "(No name)"}</td>
                  <td className="contacts-id">
                    <code>{s.id}</code>
                  </td>
                  <ContactsRowEditButton
                    label={`Edit ${s.full_name.trim() || s.id}`}
                    onEdit={() => openEditor(index)}
                  />
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="contacts-hint">Double-click a row to edit, or tap the › button</p>

        {saveError && <p className="msg-err">{saveError}</p>}
        {jsonError && dirty && <p className="msg-err">{jsonError}</p>}
      </section>

      {soldiersQ.isError && <p className="msg-err">{(soldiersQ.error as Error).message}</p>}
      {soldiersQ.data && (
        <p className="meta-line">
          Version {soldiersQ.data.version} · updated {new Date(soldiersQ.data.updated_at).toLocaleString()}
        </p>
      )}

      <SoldierEditorSheet
        open={editorOpen && draft != null}
        mode={editorMode}
        soldier={draft ?? emptySoldier(doc.soldiers)}
        onChange={setDraft}
        onDone={commitEditor}
        onCancel={() => {
          setEditorOpen(false);
          setDraft(null);
          setEditorIndex(null);
        }}
        onDelete={editorMode === "edit" ? deleteFromEditor : undefined}
      />

      <DevPanelTrigger onOpen={() => openPanel("json")} />
      <DeveloperPanel
        jsonText={editorText}
        onJsonTextChange={syncJsonToForm}
        jsonError={typeof jsonError === "string" ? jsonError : null}
        onResetDefaults={resetToServer}
      />
    </>
  );
}

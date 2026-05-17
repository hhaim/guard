import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Braces, ChevronRight, Download, Plus, Save, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPut } from "../api";
import { useDevPanel } from "../context/AppStateContext";
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
import { DevPanelTrigger, DeveloperPanel } from "./DeveloperPanel";
import { SoldierEditorSheet } from "./SoldierEditorSheet";

type CfgResp = { key: string; value: unknown; version: number; updated_at: string };

function stateLabel(state: string): string {
  if (state === "base") return "On base";
  return state.charAt(0).toUpperCase() + state.slice(1);
}

export function SoldiersView() {
  const qc = useQueryClient();
  const { openPanel } = useDevPanel();

  const soldiersQ = useQuery({
    queryKey: ["cfg", "soldiers"],
    queryFn: () => apiGet<CfgResp>("/api/cfg/soldiers"),
  });

  const [doc, setDoc] = useState<SoldiersDoc>({ soldiers: [] });
  const [baseline, setBaseline] = useState<SoldiersDoc>({ soldiers: [] });
  const [jsonOverride, setJsonOverride] = useState<string | null>(null);
  const [version, setVersion] = useState<number | undefined>();
  const [dirty, setDirty] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"edit" | "new">("edit");
  const [editorIndex, setEditorIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<Soldier | null>(null);

  useEffect(() => {
    if (!soldiersQ.data) return;
    const next = docFromServer(soldiersQ.data.value);
    setDoc(next);
    setBaseline(next);
    setJsonOverride(null);
    setVersion(soldiersQ.data.version);
    setDirty(false);
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

  const syncJsonToForm = useCallback((text: string) => {
    setJsonOverride(text);
    try {
      const parsed = parseDocFromJson(JSON.parse(text));
      setDoc(parsed);
      setDirty(true);
    } catch {
      /* keep draft */
    }
  }, []);

  const markDirty = useCallback((next: SoldiersDoc) => {
    setJsonOverride(null);
    setDoc(next);
    setDirty(true);
  }, []);

  const openEditor = useCallback((index: number, mode: "edit" | "new" = "edit") => {
    setEditorMode(mode);
    setEditorIndex(index);
    setDraft({ ...doc.soldiers[index] });
    setEditorOpen(true);
  }, [doc.soldiers]);

  const openNew = useCallback(() => {
    const next = emptySoldier(doc.soldiers.length);
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
    setDoc(baseline);
    setJsonOverride(null);
    setDirty(false);
  }, [baseline]);

  const saveM = useMutation({
    mutationFn: async () => {
      const err = jsonError;
      if (err) throw new Error(err);
      const payload = deriveJsonFromDoc(jsonOverride != null ? parseDocFromJson(JSON.parse(jsonOverride)) : doc);
      await apiPut("/api/cfg/soldiers", {
        value: payload,
        expected_version: version ?? 0,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cfg", "soldiers"] });
      setDirty(false);
      setJsonOverride(null);
    },
  });

  return (
    <>
      <header className="contacts-toolbar">
        <div className="contacts-toolbar-text">
          <h2 className="contacts-title">Soldiers</h2>
          <p className="contacts-count">
            {sortedRows.length} {sortedRows.length === 1 ? "soldier" : "soldiers"}
            {dirty ? " · unsaved changes" : ""}
          </p>
        </div>
        <div className="contacts-toolbar-actions">
          <button
            type="button"
            className="btn btn-tinted contacts-json-btn"
            aria-label="Show JSON debug panel"
            onPointerDown={(e) => {
              e.preventDefault();
              openPanel("json");
            }}
          >
            <Braces size={18} strokeWidth={2} />
            JSON
          </button>
          <button
            type="button"
            className="btn btn-tinted contacts-json-btn"
            aria-label="Export soldiers JSON"
            onPointerDown={(e) => {
              e.preventDefault();
              downloadText(
                `soldiers-${new Date().toISOString().slice(0, 10)}.json`,
                JSON.stringify(liveJson, null, 2),
                "application/json"
              );
            }}
          >
            <Download size={18} strokeWidth={2} />
            Export
          </button>
          <button
            type="button"
            className="btn btn-tinted contacts-json-btn"
            aria-label="Import soldiers JSON"
            onPointerDown={async (e) => {
              e.preventDefault();
              try {
                const text = await pickTextFile(".json,application/json");
                if (!confirm("Import soldiers JSON? This replaces the current list.")) return;
                const parsed = parseDocFromJson(JSON.parse(text));
                setDoc(parsed);
                setJsonOverride(null);
                setDirty(true);
              } catch (err) {
                alert(err instanceof Error ? err.message : "Import failed");
              }
            }}
          >
            <Upload size={18} strokeWidth={2} />
            Import
          </button>
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
        </div>
      </header>

      <section className="glass-card contacts-list-card" aria-label="Soldiers list">
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
              <th scope="col">Status</th>
              <th className="contacts-th-chevron" scope="col" />
            </tr>
          </thead>
          <tbody>
            {sortedRows.map(({ s, index }) => {
              const onBase = s.state === "base" || s.state === "";
              return (
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
                  <td>
                    <span className={`contacts-state${onBase ? " on-base" : ""}`}>{stateLabel(s.state)}</span>
                  </td>
                  <td
                    className="contacts-chevron"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      openEditor(index);
                    }}
                  >
                    <ChevronRight size={18} strokeWidth={2} aria-label="Edit soldier" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <p className="contacts-hint">Double-click a row to edit · tap › on iPhone</p>

      <div className="btn-row">
        <button
          type="button"
          className="btn btn-filled"
          disabled={saveM.isPending || !!jsonError || soldiersQ.isLoading || !dirty}
          onPointerDown={(e) => {
            e.preventDefault();
            saveM.mutate();
          }}
        >
          <Save size={18} strokeWidth={2} />
          Save soldiers
        </button>
        {dirty && (
          <button
            type="button"
            className="btn btn-plain"
            onPointerDown={(e) => {
              e.preventDefault();
              resetToServer();
            }}
          >
            Discard
          </button>
        )}
      </div>

      {soldiersQ.isError && <p className="msg-err">{(soldiersQ.error as Error).message}</p>}
      {saveM.isError && <p className="msg-err">{(saveM.error as Error).message}</p>}
      {saveM.isSuccess && <p className="msg-ok">Saved.</p>}
      {soldiersQ.data && (
        <p className="meta-line">
          Version {soldiersQ.data.version} · updated {new Date(soldiersQ.data.updated_at).toLocaleString()}
        </p>
      )}

      <SoldierEditorSheet
        open={editorOpen && draft != null}
        mode={editorMode}
        soldier={draft ?? emptySoldier(0)}
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

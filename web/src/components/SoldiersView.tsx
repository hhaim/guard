import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Braces, Download, Plus, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPut } from "../api";
import { useDevPanel } from "../context/AppStateContext";
import { formatApiError } from "../lib/apiError";
import { useIsMobile } from "../hooks/useIsMobile";
import { useSoldierPlatoonsDocument } from "../hooks/useSoldierPlatoonsDocument";
import { useSoldierTypesDocument } from "../hooks/useSoldierTypesDocument";
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
import { importSoldierStatus } from "../api/soldierStatus";
import { parsePlatoonColorsFromGlobal, platoonAvatarStyle, platoonBadgeStyle } from "../lib/platoonColors";
import { platoonLabel } from "../lib/soldierPlatoons";
import { typeLabel } from "../lib/soldierTypes";
import { downloadText, pickTextFile } from "../lib/fileIo";
import { ColumnFilterMenu } from "./ColumnFilterMenu";
import { ColumnSortButton, type SortDirection } from "./ColumnSortButton";
import { ContactsRowEditButton } from "./ContactsRowEdit";
import { DevPanelTrigger, DeveloperPanel } from "./DeveloperPanel";
import { SoldierEditorSheet } from "./SoldierEditorSheet";
import { SoldierPlatoonsSection } from "./SoldierPlatoonsSection";
import { SoldierTypesSection } from "./SoldierTypesSection";
import { SoldiersStatusBoard } from "./SoldiersStatusBoard";
import { SoldiersYamlToolbar } from "./SoldiersYamlToolbar";

type CfgResp = { key: string; value: unknown; version: number; updated_at: string };

const ROSTER_AUTOSAVE_MS = 600;

type DevJsonSource = "soldiers" | "types" | "platoons";
type RosterSortKey = "type" | "platoon" | "name" | "id";

const ROSTER_SORT_OPTIONS: { key: RosterSortKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "id", label: "ID" },
  { key: "type", label: "Type" },
  { key: "platoon", label: "Platoon" },
];

export function SoldiersView() {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const { openPanel } = useDevPanel();
  const typesCfg = useSoldierTypesDocument();
  const platoonsCfg = useSoldierPlatoonsDocument();
  const [devJsonSource, setDevJsonSource] = useState<DevJsonSource>("soldiers");
  const [searchText, setSearchText] = useState("");
  const [selectedTypeCodes, setSelectedTypeCodes] = useState<Set<string> | null>(null);
  const [selectedPlatoonCodes, setSelectedPlatoonCodes] = useState<Set<string> | null>(null);
  const [sortKey, setSortKey] = useState<RosterSortKey>("name");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");

  const soldiersQ = useQuery({
    queryKey: ["cfg", "soldiers"],
    queryFn: () => apiGet<CfgResp>("/api/cfg/soldiers"),
  });

  const globalQ = useQuery({
    queryKey: ["cfg", "global"],
    queryFn: () => apiGet<CfgResp>("/api/cfg/global"),
  });

  const platoonColors = useMemo(
    () => parsePlatoonColorsFromGlobal(globalQ.data?.value),
    [globalQ.data]
  );

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
    if (jsonOverride == null) return validateDoc(doc, typesCfg.doc, platoonsCfg.doc);
    try {
      const parsed = parseDocFromJson(JSON.parse(jsonOverride));
      return validateDoc(parsed, typesCfg.doc, platoonsCfg.doc);
    } catch (e) {
      return e instanceof Error ? e.message : "Invalid JSON";
    }
  }, [jsonOverride, doc, typesCfg.doc, platoonsCfg.doc]);

  const editorText = jsonOverride ?? JSON.stringify(liveJson, null, 2);

  const normalizedSearch = searchText.trim().toLowerCase();
  const filteredSoldierRows = useMemo(() => {
    const rows = doc.soldiers.map((s, index) => ({ s, index }));
    if (!normalizedSearch) return rows;
    return rows.filter(({ s }) => {
      const id = s.id.trim();
      const fullName = s.full_name.trim();
      const code = s.type_code?.trim() ?? "";
      const label = code ? typeLabel(typesCfg.doc, code) : "";
      const pCode = s.platoon_code?.trim() ?? "";
      const pLabel = pCode ? platoonLabel(platoonsCfg.doc, pCode) : "";
      const haystack = `${id} ${fullName} ${code} ${label} ${pCode} ${pLabel}`.toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [doc.soldiers, normalizedSearch, typesCfg.doc, platoonsCfg.doc]);

  const columnFilteredRows = useMemo(() => {
    return filteredSoldierRows.filter(({ s }) => {
      const tc = s.type_code?.trim() ?? "";
      if (selectedTypeCodes != null) {
        const key = tc || "__none__";
        if (!selectedTypeCodes.has(key)) return false;
      }
      const pc = s.platoon_code?.trim() ?? "";
      if (selectedPlatoonCodes != null) {
        const key = pc || "__none__";
        if (!selectedPlatoonCodes.has(key)) return false;
      }
      return true;
    });
  }, [filteredSoldierRows, selectedTypeCodes, selectedPlatoonCodes]);

  const typeFilterOptions = useMemo(() => {
    const codes = new Set<string>();
    let hasNone = false;
    for (const s of doc.soldiers) {
      const c = s.type_code?.trim();
      if (c) codes.add(c);
      else hasNone = true;
    }
    const opts = [...codes]
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: `${value} — ${typeLabel(typesCfg.doc, value)}` }));
    if (hasNone) opts.unshift({ value: "__none__", label: "(No type)" });
    return opts;
  }, [doc.soldiers, typesCfg.doc]);

  const platoonFilterOptions = useMemo(() => {
    const codes = new Set<string>();
    let hasNone = false;
    for (const s of doc.soldiers) {
      const c = s.platoon_code?.trim();
      if (c) codes.add(c);
      else hasNone = true;
    }
    const opts = [...codes]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((value) => ({ value, label: `${value} — ${platoonLabel(platoonsCfg.doc, value)}` }));
    if (hasNone) opts.unshift({ value: "__none__", label: "(No platoon)" });
    return opts;
  }, [doc.soldiers, platoonsCfg.doc]);

  const toggleSort = useCallback(
    (key: RosterSortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir("asc");
      }
    },
    [sortKey]
  );

  const sortedRows = useMemo(() => {
    const rows = [...columnFilteredRows];
    const sign = sortDir === "asc" ? 1 : -1;
    const compare = (a: { s: Soldier }, b: { s: Soldier }) => {
      switch (sortKey) {
        case "id":
          return (
            a.s.id.localeCompare(b.s.id, undefined, { numeric: true, sensitivity: "base" }) * sign
          );
        case "type": {
          const ta = a.s.type_code?.trim() ?? "";
          const tb = b.s.type_code?.trim() ?? "";
          return ta.localeCompare(tb, undefined, { sensitivity: "base" }) * sign;
        }
        case "platoon": {
          const pa = a.s.platoon_code?.trim() ?? "";
          const pb = b.s.platoon_code?.trim() ?? "";
          return (
            pa.localeCompare(pb, undefined, { numeric: true, sensitivity: "base" }) * sign
          );
        }
        case "name":
        default: {
          const na = a.s.full_name.trim() || a.s.id;
          const nb = b.s.full_name.trim() || b.s.id;
          return na.localeCompare(nb, undefined, { sensitivity: "base" }) * sign;
        }
      }
    };
    return rows.sort(compare);
  }, [columnFilteredRows, sortKey, sortDir]);

  const saveRosterM = useMutation({
    mutationFn: async (payload: SoldiersDoc) => {
      const err = validateDoc(payload, typesCfg.doc, platoonsCfg.doc);
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
        {!isMobile && (
          <div className="contacts-toolbar-actions">
            <button
              type="button"
              className="btn btn-tinted contacts-json-btn"
              aria-label="Show JSON debug panel"
              onClick={() => {
                setDevJsonSource("soldiers");
                openPanel("json");
              }}
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
        )}
      </header>

      <div className="soldiers-search-row">
        <input
          className="settings-input settings-input-wide soldiers-search-input"
          type="text"
          value={searchText}
          placeholder="Search by name, ID, type, or platoon"
          aria-label="Search soldiers and types"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(e) => setSearchText(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-tinted"
          onClick={() => setSearchText("")}
          disabled={!searchText.trim()}
        >
          All
        </button>
      </div>

      <SoldiersYamlToolbar
        disabled={soldiersQ.isLoading || typesCfg.typesQ.isLoading || platoonsCfg.platoonsQ.isLoading}
        typesDoc={typesCfg.doc}
        platoonsDoc={platoonsCfg.doc}
        soldiersDoc={doc}
        onImport={async ({ typesDoc, platoonsDoc, soldiersDoc, statusDoc }) => {
          if (typesDoc) typesCfg.replaceDoc(typesDoc);
          if (platoonsDoc) platoonsCfg.replaceDoc(platoonsDoc);
          if (soldiersDoc) {
            setDoc(soldiersDoc);
            setJsonOverride(null);
            setDirty(true);
            setSaveState("idle");
          }
          if (statusDoc) {
            const roster = soldiersDoc ?? doc;
            const soldier_ids = roster.soldiers.map((s) => s.id.trim()).filter(Boolean);
            await importSoldierStatus({
              range: statusDoc.range,
              soldier_ids,
              entries: statusDoc.entries,
            });
            void qc.invalidateQueries({ queryKey: ["soldiers", "status"] });
            void qc.invalidateQueries({ queryKey: ["plan", "preview-availability"] });
          }
        }}
      />

      <details className="soldiers-section-accordion">
        <summary>Soldier types</summary>
        <SoldierTypesSection
          types={typesCfg}
          soldiers={doc.soldiers}
          searchTerm={normalizedSearch}
          onOpenTypesJson={
            isMobile
              ? undefined
              : () => {
                  setDevJsonSource("types");
                  openPanel("json");
                }
          }
        />
      </details>

      <details className="soldiers-section-accordion">
        <summary>Soldier platoons</summary>
        <SoldierPlatoonsSection
          platoons={platoonsCfg}
          soldiers={doc.soldiers}
          searchTerm={normalizedSearch}
          onOpenPlatoonsJson={
            isMobile
              ? undefined
              : () => {
                  setDevJsonSource("platoons");
                  openPanel("json");
                }
          }
        />
      </details>

      <details className="soldiers-section-accordion" open>
        <summary>Status board</summary>
        <SoldiersStatusBoard
          soldiers={sortedRows.map(({ s }) => s)}
          rosterSoldiers={doc.soldiers}
          platoonsDoc={platoonsCfg.doc}
        />
      </details>

      <details className="soldiers-section-accordion" open>
        <summary>Roster</summary>
        <section className="soldiers-roster-section" aria-label="Roster">
          <header className="soldiers-roster-header">
            <div>
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

          {isMobile && (
            <div className="soldiers-roster-mobile-controls" aria-label="Sort and filter roster">
              <div className="soldiers-roster-mobile-row">
                <span className="soldiers-roster-mobile-label">Sort</span>
                <div className="soldiers-roster-mobile-chips" role="group" aria-label="Sort by column">
                  {ROSTER_SORT_OPTIONS.map(({ key, label }) => {
                    const active = sortKey === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`soldiers-roster-chip${active ? " soldiers-roster-chip-active" : ""}`}
                        aria-pressed={active}
                        aria-label={
                          active
                            ? `Sorted by ${label} ${sortDir === "asc" ? "ascending" : "descending"}`
                            : `Sort by ${label}`
                        }
                        onClick={() => toggleSort(key)}
                      >
                        {label}
                        {active ? (sortDir === "asc" ? " ↑" : " ↓") : null}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="soldiers-roster-mobile-row soldiers-roster-mobile-row-end">
                <span className="soldiers-roster-mobile-label">Filter</span>
                <div className="soldiers-roster-mobile-filters">
                  <div
                    className={`soldiers-roster-filter-chip${
                      selectedTypeCodes != null ? " soldiers-roster-filter-chip-active" : ""
                    }`}
                  >
                    <ColumnFilterMenu
                      label="type"
                      options={typeFilterOptions}
                      selected={selectedTypeCodes}
                      onChange={setSelectedTypeCodes}
                    />
                    <span>Type</span>
                  </div>
                  <div
                    className={`soldiers-roster-filter-chip${
                      selectedPlatoonCodes != null ? " soldiers-roster-filter-chip-active" : ""
                    }`}
                  >
                    <ColumnFilterMenu
                      label="platoon"
                      options={platoonFilterOptions}
                      selected={selectedPlatoonCodes}
                      onChange={setSelectedPlatoonCodes}
                    />
                    <span>Platoon</span>
                  </div>
                  {(selectedTypeCodes != null || selectedPlatoonCodes != null) && (
                    <button
                      type="button"
                      className="btn btn-plain soldiers-roster-clear-filters"
                      onClick={() => {
                        setSelectedTypeCodes(null);
                        setSelectedPlatoonCodes(null);
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="glass-card contacts-list-card">
            {soldiersQ.isLoading && <p className="contacts-empty">Loading…</p>}
            {!soldiersQ.isLoading && sortedRows.length === 0 && (
              <p className="contacts-empty">
                {normalizedSearch
                  ? "No soldiers match the current search."
                  : "No soldiers yet. Tap + to add one."}
              </p>
            )}
            <table className="contacts-table">
              <thead>
                <tr>
                  <th className="contacts-th-avatar" scope="col" />
                  <th scope="col" className="soldiers-th-type">
                    <span className="soldiers-th-filter">
                      Type
                      <ColumnSortButton
                        label="type"
                        active={sortKey === "type"}
                        direction={sortDir}
                        onToggle={() => toggleSort("type")}
                      />
                      <ColumnFilterMenu
                        label="type"
                        options={typeFilterOptions}
                        selected={selectedTypeCodes}
                        onChange={setSelectedTypeCodes}
                      />
                    </span>
                  </th>
                  <th scope="col" className="soldiers-th-type">
                    <span className="soldiers-th-filter">
                      Platoon
                      <ColumnSortButton
                        label="platoon"
                        active={sortKey === "platoon"}
                        direction={sortDir}
                        onToggle={() => toggleSort("platoon")}
                      />
                      <ColumnFilterMenu
                        label="platoon"
                        options={platoonFilterOptions}
                        selected={selectedPlatoonCodes}
                        onChange={setSelectedPlatoonCodes}
                      />
                    </span>
                  </th>
                  <th scope="col">
                    <span className="soldiers-th-filter soldiers-th-filter-left">
                      Name
                      <ColumnSortButton
                        label="name"
                        active={sortKey === "name"}
                        direction={sortDir}
                        onToggle={() => toggleSort("name")}
                      />
                    </span>
                  </th>
                  <th scope="col">
                    <span className="soldiers-th-filter soldiers-th-filter-left">
                      ID
                      <ColumnSortButton
                        label="ID"
                        active={sortKey === "id"}
                        direction={sortDir}
                        onToggle={() => toggleSort("id")}
                      />
                    </span>
                  </th>
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
                      <div
                        className="contacts-avatar contacts-avatar-soldier-id"
                        aria-hidden
                        style={
                          s.platoon_code?.trim()
                            ? platoonAvatarStyle(s.platoon_code.trim(), platoonColors)
                            : platoonAvatarStyle("", platoonColors, index)
                        }
                      >
                        {soldierInitials(s)}
                      </div>
                    </td>
                    <td className="soldiers-type-cell">
                      {s.type_code?.trim() ? (
                        <code className="soldier-type-badge" title={typeLabel(typesCfg.doc, s.type_code)}>
                          {s.type_code.trim()}
                        </code>
                      ) : (
                        <span className="soldiers-type-empty" aria-hidden>
                          —
                        </span>
                      )}
                    </td>
                    <td className="soldiers-type-cell">
                      {s.platoon_code?.trim() ? (
                        <code
                          className="soldier-type-badge"
                          title={platoonLabel(platoonsCfg.doc, s.platoon_code)}
                          style={platoonBadgeStyle(s.platoon_code.trim(), platoonColors)}
                        >
                          {s.platoon_code.trim()}
                        </code>
                      ) : (
                        <span className="soldiers-type-empty" aria-hidden>
                          —
                        </span>
                      )}
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
      </details>

      {soldiersQ.isError && <p className="msg-err">{(soldiersQ.error as Error).message}</p>}
      {soldiersQ.data && (
        <p className="meta-line">
          Version {soldiersQ.data.version} · updated {new Date(soldiersQ.data.updated_at).toLocaleString()}
        </p>
      )}

      <SoldierEditorSheet
        platoonColors={platoonColors}
        open={editorOpen && draft != null}
        mode={editorMode}
        soldier={draft ?? emptySoldier(doc.soldiers)}
        types={typesCfg.doc.types}
        platoons={platoonsCfg.doc.platoons}
        onChange={setDraft}
        onDone={commitEditor}
        onCancel={() => {
          setEditorOpen(false);
          setDraft(null);
          setEditorIndex(null);
        }}
        onDelete={editorMode === "edit" ? deleteFromEditor : undefined}
      />

      {!isMobile && (
        <DevPanelTrigger
          onOpen={() => {
            setDevJsonSource("soldiers");
            openPanel("json");
          }}
        />
      )}
      <DeveloperPanel
        jsonText={
          devJsonSource === "types"
            ? typesCfg.editorText
            : devJsonSource === "platoons"
              ? platoonsCfg.editorText
              : editorText
        }
        onJsonTextChange={
          devJsonSource === "types"
            ? typesCfg.syncJson
            : devJsonSource === "platoons"
              ? platoonsCfg.syncJson
              : syncJsonToForm
        }
        jsonError={
          devJsonSource === "types"
            ? typeof typesCfg.jsonError === "string"
              ? typesCfg.jsonError
              : null
            : devJsonSource === "platoons"
              ? typeof platoonsCfg.jsonError === "string"
                ? platoonsCfg.jsonError
                : null
              : typeof jsonError === "string"
                ? jsonError
                : null
        }
        onResetDefaults={
          devJsonSource === "types"
            ? typesCfg.resetToServer
            : devJsonSource === "platoons"
              ? platoonsCfg.resetToServer
              : resetToServer
        }
      />
    </>
  );
}

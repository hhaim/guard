import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPut } from "../api";
import { formatApiError } from "../lib/apiError";
import {
  deriveJsonFromDoc,
  docFromServer,
  parseDocFromJson,
  validateDoc,
  type SoldierPlatoonsDoc,
} from "../lib/soldierPlatoons";

type CfgResp = { key: string; value: unknown; version: number; updated_at: string };
const PLATOONS_AUTOSAVE_MS = 600;

export function useSoldierPlatoonsDocument() {
  const qc = useQueryClient();

  const platoonsQ = useQuery({
    queryKey: ["cfg", "soldier_platoons"],
    queryFn: () => apiGet<CfgResp>("/api/cfg/soldier_platoons"),
  });

  const [doc, setDoc] = useState<SoldierPlatoonsDoc>({ platoons: [] });
  const [jsonOverride, setJsonOverride] = useState<string | null>(null);
  const [version, setVersion] = useState<number | undefined>();
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "pending" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const versionRef = useRef(version);
  versionRef.current = version;
  const skipAutosaveRef = useRef(false);

  useEffect(() => {
    if (!platoonsQ.data) return;
    const next = docFromServer(platoonsQ.data.value);
    skipAutosaveRef.current = true;
    setDoc(next);
    setJsonOverride(null);
    setVersion(platoonsQ.data.version);
    setDirty(false);
    setSaveState("idle");
    setSaveError(null);
  }, [platoonsQ.data]);

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
      return validateDoc(parseDocFromJson(JSON.parse(jsonOverride)));
    } catch (e) {
      return e instanceof Error ? e.message : "Invalid JSON";
    }
  }, [jsonOverride, doc]);

  const editorText = jsonOverride ?? JSON.stringify(liveJson, null, 2);

  const docForSave = useMemo((): SoldierPlatoonsDoc | null => {
    if (jsonOverride != null) {
      try {
        return parseDocFromJson(JSON.parse(jsonOverride));
      } catch {
        return null;
      }
    }
    return doc;
  }, [doc, jsonOverride]);

  const saveM = useMutation({
    mutationFn: async (payload: SoldierPlatoonsDoc) => {
      const err = validateDoc(payload);
      if (err) throw new Error(err);
      const res = (await apiPut("/api/cfg/soldier_platoons", {
        value: deriveJsonFromDoc(payload),
        expected_version: versionRef.current ?? 0,
      })) as { version?: number };
      return res;
    },
    onSuccess: (res) => {
      if (res?.version != null) versionRef.current = res.version;
      setVersion(res?.version);
      setDirty(false);
      setSaveState("saved");
      setSaveError(null);
      void qc.invalidateQueries({ queryKey: ["cfg", "soldier_platoons"] });
    },
    onError: (e: Error) => {
      setSaveState("error");
      setSaveError(formatApiError(e));
    },
    onMutate: () => {
      setSaveState("pending");
      setSaveError(null);
    },
  });

  const markDirty = useCallback((next: SoldierPlatoonsDoc) => {
    setJsonOverride(null);
    setDoc(next);
    setDirty(true);
    setSaveState("idle");
  }, []);

  const syncJson = useCallback((text: string) => {
    setJsonOverride(text);
    try {
      setDoc(parseDocFromJson(JSON.parse(text)));
      setDirty(true);
      setSaveState("idle");
    } catch {
      /* keep draft */
    }
  }, []);

  useEffect(() => {
    if (skipAutosaveRef.current) {
      skipAutosaveRef.current = false;
      return;
    }
    if (!dirty || jsonError || !docForSave) return;
    const timer = window.setTimeout(() => {
      saveM.mutate(docForSave);
    }, PLATOONS_AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce by state
  }, [dirty, jsonError, docForSave]);

  const resetToServer = useCallback(() => {
    if (!platoonsQ.data) return;
    skipAutosaveRef.current = true;
    const next = docFromServer(platoonsQ.data.value);
    setDoc(next);
    setJsonOverride(null);
    setVersion(platoonsQ.data.version);
    setDirty(false);
    setSaveState("idle");
    setSaveError(null);
  }, [platoonsQ.data]);

  const replaceDoc = useCallback((next: SoldierPlatoonsDoc) => {
    setJsonOverride(null);
    setDoc(next);
    setDirty(true);
    setSaveState("idle");
  }, []);

  return {
    platoonsQ,
    doc,
    markDirty,
    replaceDoc,
    dirty,
    saveState,
    saveError,
    saveM,
    docForSave,
    jsonError,
    editorText,
    syncJson,
    resetToServer,
  };
}

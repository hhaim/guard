import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPut } from "../api";
import { formatApiError } from "../lib/apiError";
import {
  DEFAULT_ZONES,
  docFromCfgValue,
  docToCfgValue,
  validateZonesDoc,
  type ZonesDoc,
} from "../lib/zones";

type CfgResp = { key: string; value: unknown; version: number; updated_at: string };
const SLOTS_AUTOSAVE_MS = 600;

export function useZonesCfg() {
  const qc = useQueryClient();
  const slotsQ = useQuery({
    queryKey: ["cfg", "slots"],
    queryFn: () => apiGet<CfgResp>("/api/cfg/slots"),
  });

  const [doc, setDoc] = useState<ZonesDoc | null>(null);
  const [baseline, setBaseline] = useState<ZonesDoc | null>(null);
  const [version, setVersion] = useState<number | undefined>();
  const [dirty, setDirty] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "pending" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const versionRef = useRef(version);
  versionRef.current = version;
  const skipAutosaveRef = useRef(false);

  useEffect(() => {
    if (!slotsQ.data) return;
    try {
      const next = docFromCfgValue(slotsQ.data.value);
      skipAutosaveRef.current = true;
      setDoc(next);
      setBaseline(next);
      setVersion(slotsQ.data.version);
      setDirty(false);
      setLoadError(null);
      setSaveState("idle");
      setSaveError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load zones";
      setLoadError(msg);
      const fallback = structuredClone(DEFAULT_ZONES);
      skipAutosaveRef.current = true;
      setDoc(fallback);
      setBaseline(fallback);
      setVersion(slotsQ.data.version);
      setDirty(false);
      setSaveState("idle");
      setSaveError(null);
    }
  }, [slotsQ.data]);

  const markDirty = useCallback((next: ZonesDoc) => {
    setDoc(next);
    setDirty(true);
    setSaveState("idle");
  }, []);

  const resetToServer = useCallback(() => {
    if (baseline) {
      skipAutosaveRef.current = true;
      setDoc(structuredClone(baseline));
      setDirty(false);
      setSaveState("idle");
      setSaveError(null);
    }
  }, [baseline]);

  const replaceDoc = useCallback((next: ZonesDoc) => {
    setDoc(next);
    setDirty(true);
    setSaveState("idle");
  }, []);

  const validationError = useMemo(() => (doc ? validateZonesDoc(doc) : null), [doc]);

  const saveM = useMutation({
    mutationFn: async (payload: ZonesDoc) => {
      const err = validateZonesDoc(payload);
      if (err) throw new Error(err);
      const res = (await apiPut("/api/cfg/slots", {
        value: docToCfgValue(payload),
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
      setSaveError(null);
      qc.invalidateQueries({ queryKey: ["cfg", "slots"] });
    },
    onError: (e: Error) => {
      setSaveState("error");
      setSaveError(formatApiError(e));
    },
  });

  useEffect(() => {
    if (skipAutosaveRef.current) {
      skipAutosaveRef.current = false;
      return;
    }
    if (!dirty || validationError || !doc) return;
    const timer = window.setTimeout(() => {
      saveM.mutate(doc);
    }, SLOTS_AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce by state; mutation is stable enough
  }, [dirty, validationError, doc]);

  return {
    slotsQ,
    doc,
    baseline,
    version,
    dirty,
    loadError,
    markDirty,
    replaceDoc,
    resetToServer,
    validationError,
    saveM,
    saveState,
    saveError,
    setDoc,
  };
}

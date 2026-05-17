import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPut } from "../api";
import {
  DEFAULT_ZONES,
  docFromCfgValue,
  docToCfgValue,
  validateZonesDoc,
  type ZonesDoc,
} from "../lib/zones";

type CfgResp = { key: string; value: unknown; version: number; updated_at: string };

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

  useEffect(() => {
    if (!slotsQ.data) return;
    try {
      const next = docFromCfgValue(slotsQ.data.value);
      setDoc(next);
      setBaseline(next);
      setVersion(slotsQ.data.version);
      setDirty(false);
      setLoadError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load zones";
      setLoadError(msg);
      const fallback = structuredClone(DEFAULT_ZONES);
      setDoc(fallback);
      setBaseline(fallback);
      setVersion(slotsQ.data.version);
      setDirty(false);
    }
  }, [slotsQ.data]);

  const markDirty = useCallback((next: ZonesDoc) => {
    setDoc(next);
    setDirty(true);
  }, []);

  const resetToServer = useCallback(() => {
    if (baseline) {
      setDoc(structuredClone(baseline));
      setDirty(false);
    }
  }, [baseline]);

  const replaceDoc = useCallback((next: ZonesDoc) => {
    setDoc(next);
    setDirty(true);
  }, []);

  const validationError = useMemo(() => (doc ? validateZonesDoc(doc) : null), [doc]);

  const saveM = useMutation({
    mutationFn: async () => {
      if (!doc) throw new Error("Not loaded");
      const err = validateZonesDoc(doc);
      if (err) throw new Error(err);
      await apiPut("/api/cfg/slots", {
        value: docToCfgValue(doc),
        expected_version: version ?? 0,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cfg", "slots"] });
      setDirty(false);
    },
  });

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
    setDoc,
  };
}

import { createContext, useContext, type ReactNode } from "react";
import { useZonesCfg } from "../hooks/useZonesCfg";

type ZonesContextValue = ReturnType<typeof useZonesCfg>;

const ZonesDocumentContext = createContext<ZonesContextValue | null>(null);

export function ZonesDocumentProvider({ children }: { children: ReactNode }) {
  const value = useZonesCfg();
  return <ZonesDocumentContext.Provider value={value}>{children}</ZonesDocumentContext.Provider>;
}

export function useZonesDocument() {
  const ctx = useContext(ZonesDocumentContext);
  if (!ctx) throw new Error("useZonesDocument must be used within ZonesDocumentProvider");
  return ctx;
}

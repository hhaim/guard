import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { subscribeApiLogs, subscribeLastResponse, type ApiLogEntry } from "../api";

export type DevPanelTab = "json" | "logs" | "response";

type AppStateContextValue = {
  apiLogs: ApiLogEntry[];
  lastRawResponse: unknown;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  activeTab: DevPanelTab;
  setActiveTab: (tab: DevPanelTab) => void;
};

const AppStateContext = createContext<AppStateContextValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [apiLogs, setApiLogs] = useState<ApiLogEntry[]>([]);
  const [lastRawResponse, setLastRawResponse] = useState<unknown>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<DevPanelTab>("json");

  useEffect(() => {
    return subscribeApiLogs((entry, phase) => {
      if (phase === "start") {
        setApiLogs((prev) => [entry, ...prev]);
        return;
      }
      setApiLogs((prev) => prev.map((l) => (l.id === entry.id ? { ...entry } : l)));
    });
  }, []);

  useEffect(() => subscribeLastResponse(setLastRawResponse), []);

  const value = useMemo(
    () => ({
      apiLogs,
      lastRawResponse,
      panelOpen,
      setPanelOpen,
      activeTab,
      setActiveTab,
    }),
    [apiLogs, lastRawResponse, panelOpen, activeTab]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}

export function useDevPanel() {
  const { panelOpen, setPanelOpen, activeTab, setActiveTab } = useAppState();
  const openPanel = useCallback(
    (tab?: DevPanelTab) => {
      if (tab) setActiveTab(tab);
      setPanelOpen(true);
    },
    [setActiveTab, setPanelOpen]
  );
  return { panelOpen, setPanelOpen, activeTab, setActiveTab, openPanel };
}

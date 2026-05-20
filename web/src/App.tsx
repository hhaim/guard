import { useState } from "react";
import { GlobalConfigView } from "./components/GlobalConfigView";
import { PlanView } from "./components/PlanView";
import { StatsView } from "./components/StatsView";
import { SlotsView } from "./components/SlotsView";
import { SoldiersView } from "./components/SoldiersView";
import { TimeZonesView } from "./components/TimeZonesView";
import { ZonesDocumentProvider } from "./context/ZonesDocumentContext";

type Tab = "soldiers" | "slots" | "global" | "time_zones" | "plan" | "stats";

export default function App() {
  const [tab, setTab] = useState<Tab>("soldiers");

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Guard scheduler</h1>
        <p className="sub">
          Configure soldiers and zones, plan proposals, apply to the verified schedule, and review stats.
        </p>
      </header>
      <nav className="tab-bar" aria-label="Main navigation">
        {(
          [
            ["soldiers", "Soldiers"],
            ["slots", "Slots / zones"],
            ["global", "Global"],
            ["time_zones", "Time zones"],
            ["plan", "Plan"],
            ["stats", "Stats"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`tab-pill${tab === id ? " active" : ""}`}
            onPointerDown={(e) => {
              e.preventDefault();
              setTab(id);
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "soldiers" && <SoldiersView />}

      <ZonesDocumentProvider>
        {tab === "slots" && <SlotsView />}
        {tab === "time_zones" && <TimeZonesView />}
        {tab === "plan" && <PlanView />}
        {tab === "stats" && <StatsView />}
      </ZonesDocumentProvider>

      {tab === "global" && <GlobalConfigView />}
    </div>
  );
}

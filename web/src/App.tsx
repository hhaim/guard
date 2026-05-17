import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiGet } from "./api";
import { GlobalConfigView } from "./components/GlobalConfigView";
import { RunScheduleView } from "./components/RunScheduleView";
import { SlotsView } from "./components/SlotsView";
import { SoldiersView } from "./components/SoldiersView";
import { TimeZonesView } from "./components/TimeZonesView";
import { ZonesDocumentProvider } from "./context/ZonesDocumentContext";

type Tab = "soldiers" | "slots" | "global" | "time_zones" | "run" | "reports";

export default function App() {
  const [tab, setTab] = useState<Tab>("soldiers");

  const [repFrom, setRepFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [repTo, setRepTo] = useState(() => new Date().toISOString().slice(0, 10));
  const blocksQ = useQuery({
    queryKey: ["reports", "blocks", repFrom, repTo],
    queryFn: () =>
      apiGet<{ soldier_id: string; ts_date: string; blocks: number }[]>(
        `/api/reports/blocks?from=${encodeURIComponent(repFrom)}&to=${encodeURIComponent(repTo)}`
      ),
    enabled: tab === "reports",
  });

  const chartData = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of blocksQ.data ?? []) {
      m.set(r.soldier_id, (m.get(r.soldier_id) ?? 0) + Number(r.blocks));
    }
    return [...m.entries()].map(([soldier_id, blocks]) => ({ soldier_id, blocks }));
  }, [blocksQ.data]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Guard scheduler</h1>
        <p className="sub">Stateless API + Postgres. Configure soldiers and zones YAML, then run scheduling.</p>
      </header>
      <nav className="tab-bar" aria-label="Main navigation">
        {(
          [
            ["soldiers", "Soldiers"],
            ["slots", "Slots / zones"],
            ["global", "Global"],
            ["time_zones", "Time zones"],
            ["run", "Run schedule"],
            ["reports", "Reports"],
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
      </ZonesDocumentProvider>

      {tab === "global" && <GlobalConfigView />}

      {tab === "run" && <RunScheduleView />}

      {tab === "reports" && (
        <div className="panel">
          <div className="row">
            <label>
              From <input type="text" value={repFrom} onChange={(e) => setRepFrom(e.target.value)} />
            </label>
            <label>
              To <input type="text" value={repTo} onChange={(e) => setRepTo(e.target.value)} />
            </label>
          </div>
          <p className="sub">Block counts per soldier (aggregated across selected dates).</p>
          {blocksQ.isLoading && <p>Loading…</p>}
          {blocksQ.isError && <div className="err">{(blocksQ.error as Error).message}</div>}
          {chartData.length > 0 && (
            <div style={{ width: "100%", height: 320 }}>
              <ResponsiveContainer>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="soldier_id" angle={-25} textAnchor="end" height={80} interval={0} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="blocks" fill="#0ea5e9" name="Blocks" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <table>
            <thead>
              <tr>
                <th>Soldier</th>
                <th>Date</th>
                <th>Blocks</th>
              </tr>
            </thead>
            <tbody>
              {(blocksQ.data ?? []).map((r, i) => (
                <tr key={i}>
                  <td>{r.soldier_id}</td>
                  <td>{r.ts_date}</td>
                  <td>{r.blocks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

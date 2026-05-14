import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "./api";

type Tab = "soldiers" | "slots" | "global" | "time_zones" | "run" | "reports";

type CfgResp = { key: string; value: unknown; version: number; updated_at: string };

type TimeZoneEntry = { id: string; label: string; iana: string };
type TimeZonesResp = { zones: TimeZoneEntry[]; version: number; updated_at: string };

export default function App() {
  const [tab, setTab] = useState<Tab>("soldiers");
  const qc = useQueryClient();

  const soldiersQ = useQuery({
    queryKey: ["cfg", "soldiers"],
    queryFn: () => apiGet<CfgResp>("/api/cfg/soldiers"),
  });
  const slotsQ = useQuery({
    queryKey: ["cfg", "slots"],
    queryFn: () => apiGet<CfgResp>("/api/cfg/slots"),
  });
  const globalQ = useQuery({
    queryKey: ["cfg", "global"],
    queryFn: () => apiGet<CfgResp>("/api/cfg/global"),
  });
  const timeZonesQ = useQuery({
    queryKey: ["timeZones"],
    queryFn: () => apiGet<TimeZonesResp>("/api/time-zones"),
    enabled: tab === "time_zones",
  });

  const [soldiersText, setSoldiersText] = useState("");
  const [slotsText, setSlotsText] = useState("");
  const [globalText, setGlobalText] = useState("");
  const [vSoldiers, setVSoldiers] = useState<number | undefined>();
  const [vSlots, setVSlots] = useState<number | undefined>();
  const [vGlobal, setVGlobal] = useState<number | undefined>();
  const [tzVersion, setTzVersion] = useState<number | undefined>();
  const [newTzLabel, setNewTzLabel] = useState("");
  const [newTzIana, setNewTzIana] = useState("UTC");
  const [editId, setEditId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editIana, setEditIana] = useState("");

  useEffect(() => {
    if (soldiersQ.data) {
      setSoldiersText(JSON.stringify(soldiersQ.data.value ?? {}, null, 2));
      setVSoldiers(soldiersQ.data.version);
    }
  }, [soldiersQ.data]);
  useEffect(() => {
    if (slotsQ.data) {
      setSlotsText(JSON.stringify(slotsQ.data.value ?? {}, null, 2));
      setVSlots(slotsQ.data.version);
    }
  }, [slotsQ.data]);
  useEffect(() => {
    if (globalQ.data) {
      setGlobalText(JSON.stringify(globalQ.data.value ?? {}, null, 2));
      setVGlobal(globalQ.data.version);
    }
  }, [globalQ.data]);

  useEffect(() => {
    if (timeZonesQ.data) {
      setTzVersion(timeZonesQ.data.version);
    }
  }, [timeZonesQ.data]);

  const putSoldiers = useMutation({
    mutationFn: async () => {
      const value = JSON.parse(soldiersText);
      await apiPut("/api/cfg/soldiers", { value, expected_version: vSoldiers ?? 0 });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cfg", "soldiers"] }),
  });
  const putSlots = useMutation({
    mutationFn: async () => {
      const value = JSON.parse(slotsText);
      await apiPut("/api/cfg/slots", { value, expected_version: vSlots ?? 0 });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cfg", "slots"] }),
  });
  const putGlobal = useMutation({
    mutationFn: async () => {
      const value = JSON.parse(globalText);
      await apiPut("/api/cfg/global", { value, expected_version: vGlobal ?? 0 });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cfg", "global"] }),
  });

  const addTzM = useMutation({
    mutationFn: () =>
      apiPost("/api/time-zones", {
        expected_version: tzVersion ?? 0,
        zone: { label: newTzLabel.trim(), iana: newTzIana.trim() },
      }) as Promise<TimeZonesResp>,
    onSuccess: (data) => {
      setTzVersion(data.version);
      qc.invalidateQueries({ queryKey: ["timeZones"] });
      setNewTzLabel("");
      setNewTzIana("UTC");
    },
  });

  const patchTzM = useMutation({
    mutationFn: async (p: { id: string; label?: string; iana?: string }) => {
      const body: Record<string, unknown> = { expected_version: tzVersion ?? 0 };
      if (p.label !== undefined) body.label = p.label;
      if (p.iana !== undefined) body.iana = p.iana;
      return apiPatch(`/api/time-zones/${encodeURIComponent(p.id)}`, body) as Promise<TimeZonesResp>;
    },
    onSuccess: (data) => {
      setTzVersion(data.version);
      qc.invalidateQueries({ queryKey: ["timeZones"] });
      setEditId(null);
    },
  });

  const delTzM = useMutation({
    mutationFn: (id: string) =>
      apiDelete(`/api/time-zones/${encodeURIComponent(id)}?expected_version=${tzVersion ?? 0}`) as Promise<TimeZonesResp>,
    onSuccess: (data) => {
      setTzVersion(data.version);
      qc.invalidateQueries({ queryKey: ["timeZones"] });
    },
  });

  const [anchor, setAnchor] = useState(() => new Date().toISOString().slice(0, 10));
  const [days, setDays] = useState(5);
  const runM = useMutation({
    mutationFn: () => apiPost("/api/schedule/run", { anchor_date: anchor, days }),
  });

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
    <div className="layout">
      <header>
        <h1>Guard scheduler</h1>
        <p className="sub">Stateless API + Postgres. Configure soldiers and zones YAML, then run scheduling.</p>
      </header>
      <div className="tabs">
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
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "soldiers" && (
        <div className="panel">
          <p>
            JSON shape:{" "}
            <code>
              {`{ "update_ts": "...", "soldiers": [{ "id": "s0", "full_name": "...", "state": "base" }] }`}
            </code>
          </p>
          <textarea value={soldiersText} onChange={(e) => setSoldiersText(e.target.value)} />
          {putSoldiers.isError && <div className="err">{(putSoldiers.error as Error).message}</div>}
          {putSoldiers.isSuccess && <div className="ok">Saved.</div>}
          <button type="button" className="primary" onClick={() => putSoldiers.mutate()} disabled={putSoldiers.isPending}>
            Save soldiers
          </button>
        </div>
      )}

      {tab === "slots" && (
        <div className="panel">
          <p>
            Store zones YAML under <code>zones_yaml</code> (string), optional <code>update_ts</code>.
          </p>
          <textarea value={slotsText} onChange={(e) => setSlotsText(e.target.value)} />
          {putSlots.isError && <div className="err">{(putSlots.error as Error).message}</div>}
          <button type="button" className="primary" onClick={() => putSlots.mutate()} disabled={putSlots.isPending}>
            Save slots
          </button>
        </div>
      )}

      {tab === "global" && (
        <div className="panel">
          <p>
            Example:{" "}
            <code>
              {`{ "history_days": 14, "number_of_iteration": 1, "random_seed": 42 }`}
            </code>
          </p>
          <textarea value={globalText} onChange={(e) => setGlobalText(e.target.value)} />
          {putGlobal.isError && <div className="err">{(putGlobal.error as Error).message}</div>}
          <button type="button" className="primary" onClick={() => putGlobal.mutate()} disabled={putGlobal.isPending}>
            Save global
          </button>
        </div>
      )}

      {tab === "time_zones" && (
        <div className="panel">
          <p>
            Stored under cfg key <code>time_zones</code> (IANA names). Each change is written to{" "}
            <code>audit</code> with the full document.
          </p>
          {timeZonesQ.isLoading && <p>Loading…</p>}
          {timeZonesQ.isError && <div className="err">{(timeZonesQ.error as Error).message}</div>}
          <table>
            <thead>
              <tr>
                <th>Id</th>
                <th>Label</th>
                <th>IANA</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(timeZonesQ.data?.zones ?? []).map((z) => (
                <tr key={z.id}>
                  <td>
                    <code>{z.id}</code>
                  </td>
                  <td>
                    {editId === z.id ? (
                      <input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} />
                    ) : (
                      z.label
                    )}
                  </td>
                  <td>
                    {editId === z.id ? (
                      <input value={editIana} onChange={(e) => setEditIana(e.target.value)} />
                    ) : (
                      z.iana
                    )}
                  </td>
                  <td className="row-actions">
                    {editId === z.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            patchTzM.mutate({
                              id: z.id,
                              label: editLabel,
                              iana: editIana,
                            })
                          }
                          disabled={patchTzM.isPending}
                        >
                          Save
                        </button>
                        <button type="button" onClick={() => setEditId(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditId(z.id);
                            setEditLabel(z.label);
                            setEditIana(z.iana);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(`Remove ${z.id}?`)) delTzM.mutate(z.id);
                          }}
                          disabled={delTzM.isPending}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: "1rem", gap: "0.75rem", alignItems: "flex-end" }}>
            <label>
              Label{" "}
              <input type="text" value={newTzLabel} onChange={(e) => setNewTzLabel(e.target.value)} />
            </label>
            <label>
              IANA{" "}
              <input type="text" value={newTzIana} onChange={(e) => setNewTzIana(e.target.value)} />
            </label>
            <button type="button" className="primary" onClick={() => addTzM.mutate()} disabled={addTzM.isPending}>
              Add time zone
            </button>
          </div>
          {addTzM.isError && <div className="err">{(addTzM.error as Error).message}</div>}
          {patchTzM.isError && <div className="err">{(patchTzM.error as Error).message}</div>}
          {delTzM.isError && <div className="err">{(delTzM.error as Error).message}</div>}
          <p className="sub">Version {timeZonesQ.data?.version ?? "—"} · updated {timeZonesQ.data?.updated_at ?? "—"}</p>
        </div>
      )}

      {tab === "run" && (
        <div className="panel">
          <div className="row">
            <label>
              Anchor date{" "}
              <input type="text" value={anchor} onChange={(e) => setAnchor(e.target.value)} />
            </label>
            <label>
              Days{" "}
              <input
                type="number"
                min={1}
                max={90}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                style={{ width: "5rem" }}
              />
            </label>
          </div>
          <button type="button" className="primary" onClick={() => runM.mutate()} disabled={runM.isPending}>
            Run schedule
          </button>
          {runM.isError && <div className="err">{(runM.error as Error).message}</div>}
          {runM.isSuccess && (
            <div className="ok">
              Done: {(runM.data as { assignments?: number }).assignments} assignments.
            </div>
          )}
        </div>
      )}

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

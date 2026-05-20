import { Show, SignInButton, UserButton } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet } from "./api";
import { AdminUsersView } from "./components/AdminUsersView";
import { GlobalConfigView } from "./components/GlobalConfigView";
import { PlanView } from "./components/PlanView";
import { StatsView } from "./components/StatsView";
import { SlotsView } from "./components/SlotsView";
import { SoldiersView } from "./components/SoldiersView";
import { TimeZonesView } from "./components/TimeZonesView";
import { ZonesDocumentProvider } from "./context/ZonesDocumentContext";
import { useApiClient } from "./hooks/useApiClient";

type Tab = "soldiers" | "slots" | "global" | "time_zones" | "plan" | "stats" | "users";

type MeResponse = { role: string; email: string };

const ADMIN_TABS: { id: Tab; label: string }[] = [
  { id: "soldiers", label: "Soldiers" },
  { id: "slots", label: "Slots / zones" },
  { id: "global", label: "Global" },
  { id: "time_zones", label: "Time zones" },
  { id: "plan", label: "Plan" },
  { id: "stats", label: "Stats" },
  { id: "users", label: "Users" },
];

const READONLY_TABS: { id: Tab; label: string }[] = [
  { id: "plan", label: "Plan" },
  { id: "stats", label: "Stats" },
];

function SignedInApp() {
  useApiClient();
  const meQ = useQuery({
    queryKey: ["me"],
    queryFn: () => apiGet<MeResponse>("/api/me"),
    retry: false,
  });

  const role = meQ.data?.role ?? "";
  const isAdmin = role === "admin";
  const isReadonly = role === "readonly";
  const tabs = isAdmin ? ADMIN_TABS : isReadonly ? READONLY_TABS : [];
  const [tab, setTab] = useState<Tab>(isReadonly ? "plan" : "soldiers");

  if (meQ.isLoading) {
    return <p className="sub">Loading your account…</p>;
  }

  if (meQ.isError || !role) {
    return (
      <section className="panel">
        <h2>Access not granted</h2>
        <p className="sub">
          You are signed in, but this app has no role for your account yet. Ask an admin to invite your email (
          {meQ.error ? "could not load profile" : "pending invite"}).
        </p>
      </section>
    );
  }

  return (
    <>
      <nav className="tab-bar" aria-label="Main navigation">
        {tabs.map(({ id, label }) => (
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
        {tab === "plan" && <PlanView readOnly={isReadonly} />}
        {tab === "stats" && <StatsView />}
      </ZonesDocumentProvider>
      {tab === "global" && <GlobalConfigView />}
      {tab === "users" && isAdmin && <AdminUsersView />}
    </>
  );
}

export default function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-row">
          <div>
            <h1>Guard scheduler</h1>
            <p className="sub">
              Configure soldiers and zones, plan proposals, apply to the verified schedule, and review stats.
            </p>
          </div>
          <Show when="signed-in">
            <UserButton />
          </Show>
        </div>
      </header>

      <Show when="signed-out">
        <section className="panel sign-in-panel">
          <h2>Sign in</h2>
          <p className="sub">Use Google via Clerk. Access is invitation-only after the first admin is bootstrapped.</p>
          <SignInButton mode="modal">
            <button type="button" className="btn btn-filled">
              Sign in
            </button>
          </SignInButton>
        </section>
      </Show>

      <Show when="signed-in">
        <SignedInApp />
      </Show>
    </div>
  );
}

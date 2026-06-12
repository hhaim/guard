import { Show, SignInButton, UserButton, useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { callApi } from "./api";
import { formatApiError } from "./lib/apiError";
import { AdminUsersView } from "./components/AdminUsersView";
import { GlobalConfigView } from "./components/GlobalConfigView";
import { HelpView } from "./components/HelpView";
import { PlanView } from "./components/PlanView";
import { StatsView } from "./components/StatsView";
import { SlotsView } from "./components/SlotsView";
import { SoldiersView } from "./components/SoldiersView";
import { TimeZonesView } from "./components/TimeZonesView";
import { ZonesDocumentProvider } from "./context/ZonesDocumentContext";
import { AccessDeniedDebug, type AuthDiagnostics } from "./components/AccessDeniedDebug";
import { useApiClient } from "./hooks/useApiClient";

type Tab = "soldiers" | "slots" | "global" | "time_zones" | "plan" | "stats" | "help" | "users";

type MeResponse = {
  role: string;
  email: string;
  clerk_user_id?: string;
  diagnostics?: AuthDiagnostics;
};

const ADMIN_TABS: { id: Tab; label: string }[] = [
  { id: "soldiers", label: "Soldiers" },
  { id: "slots", label: "Slots / zones" },
  { id: "global", label: "Global" },
  { id: "time_zones", label: "Time zones" },
  { id: "plan", label: "Plan" },
  { id: "stats", label: "Stats" },
  { id: "help", label: "Help" },
  { id: "users", label: "Users" },
];

const READONLY_TABS: { id: Tab; label: string }[] = [
  { id: "plan", label: "Plan" },
  { id: "stats", label: "Stats" },
  { id: "help", label: "Help" },
];

function SignedInApp() {
  const { getToken, isLoaded } = useAuth();
  useApiClient();
  const meQ = useQuery({
    queryKey: ["me"],
    enabled: isLoaded,
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Session not ready — refresh the page");
      return callApi<MeResponse>("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
    },
    retry: (count, err) => {
      const msg = formatApiError(err).toLowerCase();
      if (count >= 2) return false;
      return msg.includes("unauthorized") || msg.includes("session") || msg.includes("not ready");
    },
  });

  const role = meQ.data?.role ?? "";
  const isAdmin = role === "admin";
  const isReadonly = role === "readonly";
  const tabs = isAdmin ? ADMIN_TABS : isReadonly ? READONLY_TABS : [];
  const [tab, setTab] = useState<Tab>(isReadonly ? "plan" : "soldiers");
  const [helpSection, setHelpSection] = useState<string | null>(null);
  const [helpReturnTab, setHelpReturnTab] = useState<Tab | null>(null);
  const [openPlanExpertRules, setOpenPlanExpertRules] = useState(false);

  const openHelp = (sectionId?: string) => {
    setHelpReturnTab(tab);
    setOpenPlanExpertRules(sectionId === "expert-rules");
    if (sectionId) setHelpSection(sectionId);
    setTab("help");
  };

  const returnFromHelp = () => {
    if (!helpReturnTab) return;
    setTab(helpReturnTab);
    setHelpReturnTab(null);
  };

  if (meQ.isLoading) {
    return <p className="sub">Loading your account…</p>;
  }

  if (meQ.isError || !role) {
    const errDetail = meQ.isError ? formatApiError(meQ.error) : "";
    const emailHint = meQ.data?.email ? ` (${meQ.data.email})` : "";
    return (
      <section className="panel">
        <h2>Access not granted</h2>
        <p className="sub">
          You are signed in, but this app has no role for your account yet. Ask an admin to invite your email
          {emailHint || " (must match your Google sign-in)"} (
          {meQ.isError ? errDetail || "could not load profile" : "pending invite"}).
        </p>
        <AccessDeniedDebug meError={meQ.error} meData={meQ.data} />
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
              if (id !== "help") setHelpReturnTab(null);
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
        {tab === "plan" && (
          <PlanView
            readOnly={isReadonly}
            onOpenHelp={openHelp}
            openExpertRulesAccordion={openPlanExpertRules}
            onExpertRulesAccordionOpened={() => setOpenPlanExpertRules(false)}
          />
        )}
        {tab === "stats" && <StatsView isAdmin={isAdmin} />}
      </ZonesDocumentProvider>
      {tab === "global" && <GlobalConfigView />}
      {tab === "help" && (
        <HelpView
          scrollToSection={helpSection}
          onScrolledToSection={() => setHelpSection(null)}
          showBackToPlan={helpReturnTab === "plan"}
          onBackToPlan={returnFromHelp}
        />
      )}
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

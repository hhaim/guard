import { useAuth, useUser } from "@clerk/react";
import { useEffect, useState } from "react";
import { formatApiError } from "../lib/apiError";

type MeResponse = {
  role?: string;
  email?: string;
  clerk_user_id?: string;
  diagnostics?: AuthDiagnostics;
  error?: string;
  debug?: { diagnostics?: AuthDiagnostics };
};

export type AuthDiagnostics = {
  clerk_user_id: string;
  email: string;
  role: string;
  sync_path: string;
  db_by_clerk_id?: { clerk_user_id: string; email: string; role: string };
  db_by_email?: { clerk_user_id: string; email: string; role: string };
  clerk_id_matches_db: boolean;
  email_matches_db: boolean;
  bootstrap_configured: boolean;
  bootstrap_email_match: boolean;
  admin_count: number;
  has_pending_invite: boolean;
  errors?: string[];
};

type ProbeResult = {
  label: string;
  status: number | "error" | "skip";
  body: unknown;
};

async function probe(
  label: string,
  url: string,
  token: string | null
): Promise<ProbeResult> {
  if (!token) {
    return { label, status: "skip", body: "No Bearer token (Clerk session not ready)" };
  }
  try {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const text = await r.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* plain text */
    }
    return { label, status: r.status, body };
  } catch (e) {
    return { label, status: "error", body: e instanceof Error ? e.message : String(e) };
  }
}

function diagSummary(d: AuthDiagnostics | undefined): string[] {
  if (!d) return [];
  const lines: string[] = [
    `sync_path: ${d.sync_path}`,
    `session role: ${d.role || "(empty)"}`,
    `clerk_id_matches_db: ${d.clerk_id_matches_db}`,
    `email_matches_db: ${d.email_matches_db}`,
    `admin_count: ${d.admin_count}`,
  ];
  if (d.db_by_clerk_id) {
    lines.push(
      `DB by clerk id: ${d.db_by_clerk_id.clerk_user_id} / ${d.db_by_clerk_id.email} / role=${d.db_by_clerk_id.role}`
    );
  } else {
    lines.push("DB by clerk id: (no row)");
  }
  if (d.db_by_email) {
    lines.push(
      `DB by email: ${d.db_by_email.clerk_user_id} / ${d.db_by_email.email} / role=${d.db_by_email.role}`
    );
  }
  if (d.errors?.length) lines.push(`errors: ${d.errors.join("; ")}`);
  return lines;
}

export function AccessDeniedDebug({
  meError,
  meData,
}: {
  meError: unknown;
  meData?: { role?: string; email?: string; diagnostics?: AuthDiagnostics };
}) {
  const { user, isLoaded } = useUser();
  const { getToken } = useAuth();
  const [probes, setProbes] = useState<ProbeResult[] | null>(null);
  const [tokenInfo, setTokenInfo] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getToken();
      if (cancelled) return;
      if (!token) {
        setTokenInfo("missing");
      } else {
        setTokenInfo(`present (${token.length} chars)`);
      }
      const results = await Promise.all([
        probe("GET /api/me", "/api/me", token),
        probe("GET /api/auth/debug", "/api/auth/debug", token),
      ]);
      if (!cancelled) setProbes(results);
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken, isLoaded]);

  const meProbe = probes?.find((p) => p.label === "GET /api/me");
  const debugProbe = probes?.find((p) => p.label === "GET /api/auth/debug");
  const diagFromProbe =
    (debugProbe?.body as { diagnostics?: AuthDiagnostics } | undefined)?.diagnostics ??
    (meProbe?.body as MeResponse | undefined)?.diagnostics ??
    (meProbe?.body as { debug?: { diagnostics?: AuthDiagnostics } } | undefined)?.debug?.diagnostics ??
    meData?.diagnostics;

  return (
    <details className="access-denied-debug" open>
      <summary>Auth debug (for support)</summary>
      <div className="access-denied-debug-body">
        <p className="contacts-hint">
          Compare <strong>Clerk user id</strong> below with <code>app_users.clerk_user_id</code> from{" "}
          <code>guardcli users debug</code>.
        </p>
        <table className="contacts-table access-denied-debug-table">
          <tbody>
            <tr>
              <th scope="row">Clerk (browser)</th>
              <td>
                <code>{isLoaded ? user?.id ?? "(none)" : "loading…"}</code>
              </td>
            </tr>
            <tr>
              <th scope="row">Clerk email</th>
              <td>
                <code>{user?.primaryEmailAddress?.emailAddress ?? "—"}</code>
              </td>
            </tr>
            <tr>
              <th scope="row">Bearer token</th>
              <td>
                <code>{tokenInfo || "…"}</code>
              </td>
            </tr>
            <tr>
              <th scope="row">/api/me error</th>
              <td>
                <code>{meError ? formatApiError(meError) : meData?.role ? `ok role=${meData.role}` : "—"}</code>
              </td>
            </tr>
          </tbody>
        </table>
        {diagFromProbe && (
          <ul className="access-denied-debug-list">
            {diagSummary(diagFromProbe).map((line) => (
              <li key={line}>
                <code>{line}</code>
              </li>
            ))}
          </ul>
        )}
        {probes?.map((p) => (
          <div key={p.label} className="access-denied-debug-probe">
            <strong>
              {p.label} → {String(p.status)}
            </strong>
            <pre>{JSON.stringify(p.body, null, 2)}</pre>
          </div>
        ))}
        <p className="contacts-hint">
          <strong>401 on /api/me</strong> means the API rejected the Clerk JWT (not the database). Confirm{" "}
          <code>CLERK_SECRET_KEY</code> in the API container matches the same Clerk app as{" "}
          <code>VITE_CLERK_PUBLISHABLE_KEY</code>. Open <code>/health</code> — it should show{" "}
          <code>auth.clerk_jwt: true</code>. If you use Vite on port 5173, rebuild the API after this fix (authorized
          parties include <code>http://localhost:5173</code>).
        </p>
        <p className="contacts-hint">
          API logs: set <code>AUTH_DEBUG=1</code> on the API container and check <code>docker compose logs api</code>{" "}
          for <code>jwt_verify_error</code>.
        </p>
      </div>
    </details>
  );
}

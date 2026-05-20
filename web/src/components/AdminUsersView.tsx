import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiDelete, apiGet, apiPost } from "../api";

type InviteRow = {
  id: number;
  email: string;
  role: string;
  invited_by: string;
  created_at: string;
  accepted_at?: string;
  pending: boolean;
};

export function AdminUsersView() {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "readonly">("readonly");
  const [err, setErr] = useState<string | null>(null);

  const invitesQ = useQuery({
    queryKey: ["admin", "invites"],
    queryFn: () => apiGet<InviteRow[]>("/api/admin/invites"),
  });

  const createM = useMutation({
    mutationFn: () => apiPost("/api/admin/invites", { email: email.trim(), role }),
    onSuccess: () => {
      setEmail("");
      setErr(null);
      void qc.invalidateQueries({ queryKey: ["admin", "invites"] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Invite failed"),
  });

  const revokeM = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/admin/invites/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "invites"] }),
  });

  return (
    <section className="panel">
      <h2>Users & invites</h2>
      <p className="sub">
        Invite teammates by email. They receive a Clerk invitation and get the selected role on first sign-in.
      </p>

      <form
        className="admin-invite-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!email.trim()) return;
          createM.mutate();
        }}
      >
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@example.com"
            required
          />
        </label>
        <label>
          Role
          <select value={role} onChange={(e) => setRole(e.target.value as "admin" | "readonly")}>
            <option value="readonly">Read-only (Plan + Stats)</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button type="submit" className="btn btn-filled" disabled={createM.isPending}>
          {createM.isPending ? "Sending…" : "Send invite"}
        </button>
      </form>
      {err ? <p className="error-text">{err}</p> : null}

      {invitesQ.isLoading ? <p>Loading invites…</p> : null}
      {invitesQ.error ? (
        <p className="error-text">{invitesQ.error instanceof Error ? invitesQ.error.message : "Failed to load"}</p>
      ) : null}

      {invitesQ.data && invitesQ.data.length > 0 ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {invitesQ.data.map((row) => (
              <tr key={row.id}>
                <td>{row.email}</td>
                <td>{row.role}</td>
                <td>{row.pending ? "Pending" : "Accepted"}</td>
                <td>
                  {row.pending ? (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={revokeM.isPending}
                      onClick={() => revokeM.mutate(row.id)}
                    >
                      Revoke
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : invitesQ.isSuccess ? (
        <p className="sub">No invites yet.</p>
      ) : null}
    </section>
  );
}

import { apiDelete, apiGet, apiPatch, apiPost } from "../api";

export type SoldierStatusKind =
  | "away"
  | "sick"
  | "training"
  | "other"
  | "outing";

export type SoldierStatusEntry = {
  id?: number;
  soldier_id: string;
  start_at: string;
  end_at?: string | null;
  status: SoldierStatusKind | string;
  note?: string;
  actor?: string;
  editable: boolean;
};

export async function listSoldierStatus(
  from: string,
  to: string,
  soldierId?: string,
): Promise<SoldierStatusEntry[]> {
  const q = new URLSearchParams({ from, to });
  if (soldierId) q.set("soldier_id", soldierId);
  const data = await apiGet<{ entries: SoldierStatusEntry[] }>(
    `/api/soldiers/status?${q.toString()}`,
  );
  return data.entries ?? [];
}

export async function createSoldierStatus(body: {
  soldier_id: string;
  start_at: string;
  end_at?: string | null;
  status: SoldierStatusKind;
  note?: string;
}): Promise<{ id: number }> {
  return apiPost("/api/soldiers/status", body) as Promise<{ id: number }>;
}

export async function patchSoldierStatus(
  id: number,
  startAt: string,
  body: { end_at?: string | null; note?: string },
): Promise<void> {
  const q = new URLSearchParams({ start_at: startAt });
  await apiPatch(`/api/soldiers/status/${id}?${q.toString()}`, body);
}

export async function deleteSoldierStatus(id: number, startAt: string): Promise<void> {
  const q = new URLSearchParams({ start_at: startAt });
  await apiDelete(`/api/soldiers/status/${id}?${q.toString()}`);
}

/** Remove blocking status for [start_at, end_at) so the soldier is on base for that window. */
export async function clearSoldierStatusWindow(body: {
  soldier_id: string;
  start_at: string;
  end_at: string;
}): Promise<void> {
  await apiPost("/api/soldiers/status/clear", body);
}

export type SoldierStatusImportPayload = {
  range: { from: string; to: string };
  soldier_ids: string[];
  entries: Array<{
    soldier_id: string;
    start_at: string;
    end_at?: string | null;
    status: SoldierStatusKind | string;
    note?: string;
  }>;
};

export async function importSoldierStatus(payload: SoldierStatusImportPayload): Promise<void> {
  await apiPost("/api/soldiers/status/import", payload);
}

const base = "";

export async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(`${base}${path}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<T>;
}

export async function apiPut(path: string, body: unknown): Promise<unknown> {
  const r = await fetch(`${base}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...headers() },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function apiPost(path: string, body: unknown): Promise<unknown> {
  const r = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers() },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t);
  }
  return r.json();
}

export async function apiPatch(path: string, body: unknown): Promise<unknown> {
  const r = await fetch(`${base}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...headers() },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function apiDelete(path: string): Promise<unknown> {
  const r = await fetch(`${base}${path}`, {
    method: "DELETE",
    headers: headers(),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function headers(): Record<string, string> {
  const k = import.meta.env.VITE_API_KEY as string | undefined;
  if (k) return { "X-API-Key": k };
  return {};
}

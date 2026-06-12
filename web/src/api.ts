import { ApiError } from "./lib/apiError";

const base = "";

export { ApiError } from "./lib/apiError";
export type { ParsedApiError } from "./lib/apiError";

export type ApiLogStatus = number | "pending" | "error";

export type ApiLogEntry = {
  id: string;
  ts: Date;
  method: string;
  endpoint: string;
  status: ApiLogStatus;
  latency?: number;
  request?: unknown;
  response?: unknown;
  error?: string;
};

type LogListener = (entry: ApiLogEntry, phase: "start" | "update") => void;
const logListeners = new Set<LogListener>();

export function subscribeApiLogs(fn: LogListener): () => void {
  logListeners.add(fn);
  return () => logListeners.delete(fn);
}

type ResponseListener = (data: unknown) => void;
const responseListeners = new Set<ResponseListener>();

export function subscribeLastResponse(fn: ResponseListener): () => void {
  responseListeners.add(fn);
  return () => responseListeners.delete(fn);
}

function uuid(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type TokenGetter = () => Promise<string | null>;
let tokenGetter: TokenGetter | null = null;

export function setApiTokenGetter(fn: TokenGetter | null) {
  tokenGetter = fn;
}

async function buildHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const h: Record<string, string> = { "Content-Type": "application/json", ...extra };
  if (tokenGetter) {
    const token = await tokenGetter();
    if (token) h.Authorization = `Bearer ${token}`;
  }
  const k = import.meta.env.VITE_API_KEY as string | undefined;
  if (k) h["X-API-Key"] = k;
  return h;
}

function emitLog(entry: ApiLogEntry, phase: "start" | "update") {
  for (const fn of logListeners) fn(entry, phase);
}

function emitResponse(data: unknown) {
  for (const fn of responseListeners) fn(data);
}

export async function callApi<T = unknown>(
  endpoint: string,
  options: RequestInit & { parseJson?: boolean } = {}
): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const parseJson = options.parseJson !== false;
  let requestBody: unknown;
  if (typeof options.body === "string" && options.body) {
    try {
      requestBody = JSON.parse(options.body);
    } catch {
      requestBody = options.body;
    }
  }

  const start = Date.now();
  const logEntry: ApiLogEntry = {
    id: uuid(),
    ts: new Date(),
    method,
    endpoint,
    status: "pending",
    request: requestBody,
  };
  emitLog(logEntry, "start");

  const updateLog = (patch: Partial<ApiLogEntry>) => {
    Object.assign(logEntry, patch);
    emitLog(logEntry, "update");
  };

  try {
    const hdrs = await buildHeaders(options.headers as Record<string, string> | undefined);
    const r = await fetch(`${base}${endpoint}`, {
      ...options,
      headers: hdrs,
    });

    const text = await r.text();
    let data: unknown = text;
    if (parseJson && text) {
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        data = text;
      }
    }

    if (!r.ok) {
      updateLog({
        status: r.status,
        latency: Date.now() - start,
        error: typeof data === "string" ? data : JSON.stringify(data),
        response: data,
      });
      throw new ApiError(r.status, data);
    }

    updateLog({
      status: r.status,
      latency: Date.now() - start,
      response: data,
    });
    if (parseJson) emitResponse(data);
    return data as T;
  } catch (err) {
    if (logEntry.status === "pending") {
      updateLog({
        status: "error",
        latency: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    throw err;
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  return callApi<T>(path, { method: "GET" });
}

export async function apiPut(path: string, body: unknown): Promise<unknown> {
  return callApi(path, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function apiPost(path: string, body: unknown): Promise<unknown> {
  return callApi(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function apiPatch(path: string, body: unknown): Promise<unknown> {
  return callApi(path, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function apiDelete(path: string): Promise<unknown> {
  return callApi(path, { method: "DELETE", parseJson: true });
}

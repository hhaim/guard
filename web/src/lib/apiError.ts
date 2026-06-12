/** Structured API error envelope (plan + simulation endpoints). */
export type ParsedApiError = {
  headline: string;
  code?: string;
  status?: number;
  message: string;
  request?: Record<string, unknown>;
  processing?: Record<string, unknown>;
  hints?: string[];
  details?: Record<string, unknown>;
  conflicting_dates?: string[];
  raw?: unknown;
};

const CODE_HEADLINES: Record<string, string> = {
  rest_constraint: "Could not assign all duties",
  type_quota_unfilled: "Not enough soldiers of the required type",
  schedule_conflict: "Verified schedule already has these days",
  anchor_mismatch: "Planning anchor does not match server",
  history_shift_mismatch: "History day uses a different shift length",
  history_bootstrap_trials: "Use one trial or fix history checkpoint",
  history_load_failed: "Could not load verified history",
  version_conflict: "Proposal was updated elsewhere",
  validation: "Fix form inputs",
  internal: "Unexpected server error",
  simulation_failed: "Schedule simulation failed",
  not_found: "Not found",
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function parseErrorBody(raw: string): Record<string, unknown> | null {
  const t = raw.trim();
  if (!t.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(t) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function headlineForCode(code: string | undefined, fallback: string): string {
  if (!code) return fallback;
  return CODE_HEADLINES[code] ?? fallback;
}

/** Infer simulator sub-code when the API omits `code` (legacy bodies). */
function inferCodeFromMessage(message: string): string | undefined {
  if (message.includes("full_day_team:")) return "type_quota_unfilled";
  if (message.includes("rest constraint") || message.includes("cannot fill day")) return "rest_constraint";
  if (message.includes("schedule_conflict")) return "schedule_conflict";
  return undefined;
}

/** True when the server returned the structured plan/sim error envelope. */
export function isStructuredApiError(p: ParsedApiError): boolean {
  return Boolean(
    p.code &&
      (p.processing != null ||
        p.request != null ||
        (p.hints != null && p.hints.length > 0) ||
        p.details != null)
  );
}

function parsedFromBody(body: Record<string, unknown>, status?: number, raw?: unknown): ParsedApiError {
  const errField = typeof body.error === "string" ? body.error : "";
  const msgField = typeof body.message === "string" ? body.message : errField;
  const code =
    (typeof body.code === "string" ? body.code : undefined) ?? inferCodeFromMessage(msgField);
  const headline = headlineForCode(code, errField || msgField || "Request failed");

  const hints = Array.isArray(body.hints)
    ? body.hints.filter((h): h is string => typeof h === "string")
    : undefined;

  const conflicting_dates = Array.isArray(body.conflicting_dates)
    ? body.conflicting_dates.filter((d): d is string => typeof d === "string")
    : undefined;

  return {
    headline,
    code,
    status: typeof body.status === "number" ? body.status : status,
    message: msgField || headline,
    request: isRecord(body.request) ? body.request : undefined,
    processing: isRecord(body.processing) ? body.processing : undefined,
    hints,
    details: isRecord(body.details) ? body.details : undefined,
    conflicting_dates,
    raw: raw ?? body,
  };
}

/** Parse callApi / mutation failures into a structured plan error. */
export function parseApiError(err: unknown): ParsedApiError {
  if (err instanceof ApiError) {
    return err.parsed;
  }

  const message = err instanceof Error ? err.message : String(err);
  const body = parseErrorBody(message);

  if (!body) {
    return {
      headline: message || "Request failed",
      message: message || "Request failed",
      raw: err,
    };
  }

  return parsedFromBody(body, undefined, body);
}

/** Short single-line message for toasts or legacy UI. */
export function formatApiError(err: unknown): string {
  return parseApiError(err).headline;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly parsed: ParsedApiError;

  constructor(status: number, body: unknown, message?: string) {
    const rawMsg =
      message ??
      (typeof body === "string"
        ? body
        : isRecord(body) && typeof body.error === "string"
          ? body.error
          : JSON.stringify(body));
    super(rawMsg);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    if (isRecord(body)) {
      this.parsed = parsedFromBody(body, status, body);
    } else {
      const parsed = parseErrorBody(rawMsg);
      this.parsed = parsed
        ? parsedFromBody(parsed, status, body)
        : {
            headline: rawMsg || "Request failed",
            message: rawMsg || "Request failed",
            status,
            raw: body,
          };
    }
  }
}

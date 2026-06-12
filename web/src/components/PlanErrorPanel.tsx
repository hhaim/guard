import { Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { isStructuredApiError, type ParsedApiError } from "../lib/apiError";

function formatKvList(data: Record<string, unknown> | undefined): { key: string; value: string }[] {
  if (!data) return [];
  return Object.entries(data)
    .filter(([k]) => !k.startsWith("_") && k !== "raw")
    .map(([key, value]) => ({
      key,
      value:
        value == null
          ? "—"
          : typeof value === "object"
            ? JSON.stringify(value)
            : String(value),
    }));
}

export function PlanErrorPanel({
  error,
  clientRequest,
  title = "Something went wrong",
  defaultOpenTechnical = false,
}: {
  error: ParsedApiError;
  /** Last client params (e.g. generate) when server omits request. */
  clientRequest?: Record<string, unknown>;
  title?: string;
  /** Open technical JSON by default (e.g. right after generate failure). */
  defaultOpenTechnical?: boolean;
}) {
  const structured = isStructuredApiError(error);
  const [showTech, setShowTech] = useState(defaultOpenTechnical || structured);

  useEffect(() => {
    if (defaultOpenTechnical || structured) {
      setShowTech(true);
    }
  }, [defaultOpenTechnical, structured, error.code, error.status]);

  const request = error.request ?? clientRequest;
  const processing = error.processing;
  const debugPayload =
    error.raw != null && typeof error.raw === "object"
      ? error.raw
      : {
          error: error.headline,
          code: error.code,
          status: error.status,
          message: error.message,
          request: error.request,
          processing: error.processing,
          hints: error.hints,
          details: error.details,
          conflicting_dates: error.conflicting_dates,
        };

  const copyDebug = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(debugPayload, null, 2));
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="plan-error-panel glass-card" role="alert">
      <div className="plan-error-title-row">
        <h4 className="plan-error-title">{title}</h4>
        {structured ? (
          <span className="plan-error-badge" title="Response includes code, processing, and/or hints from the API">
            Structured API
          </span>
        ) : (
          <span className="plan-error-badge plan-error-badge-legacy" title="Plain or legacy error body">
            Legacy format
          </span>
        )}
      </div>
      <p className="plan-error-headline">{error.headline}</p>
      {error.status != null && (
        <p className="plan-error-meta">
          HTTP {error.status}
          {error.code ? ` · ${error.code}` : null}
        </p>
      )}
      {error.message && error.message !== error.headline && (
        <p className="plan-error-message">{error.message}</p>
      )}
      {error.conflicting_dates && error.conflicting_dates.length > 0 && (
        <p className="plan-error-message">
          Conflicting dates: {error.conflicting_dates.join(", ")}
        </p>
      )}

      {error.details && Object.keys(error.details).length > 0 && (
        <section className="plan-error-section">
          <h5>Where it failed</h5>
          <dl className="plan-error-dl">
            {formatKvList(error.details).map(({ key, value }) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {request && Object.keys(request).length > 0 && (
        <section className="plan-error-section">
          <h5>What we sent</h5>
          <dl className="plan-error-dl">
            {formatKvList(request).map(({ key, value }) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {processing && Object.keys(processing).length > 0 && (
        <section className="plan-error-section">
          <h5>How it was processed</h5>
          <dl className="plan-error-dl">
            {formatKvList(processing).map(({ key, value }) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {error.hints && error.hints.length > 0 && (
        <section className="plan-error-section">
          <h5>Suggestions</h5>
          <ul className="plan-error-hints">
            {error.hints.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </section>
      )}

      {!structured && (
        <p className="plan-error-legacy-hint">
          Start or rebuild the API server if you expect <strong>Structured API</strong> with processing context
          (soldier_count, sim_mode, …).
        </p>
      )}

      <details
        className="plan-error-tech"
        open={showTech}
        onToggle={(e) => setShowTech((e.target as HTMLDetailsElement).open)}
      >
        <summary>Technical details (full REST body)</summary>
        <div className="plan-error-tech-actions">
          <button type="button" className="btn btn-tinted btn-sm" onClick={() => void copyDebug()}>
            <Copy size={14} />
            Copy debug
          </button>
        </div>
        <pre className="plan-error-pre">{JSON.stringify(debugPayload, null, 2)}</pre>
      </details>
    </div>
  );
}

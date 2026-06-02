import { Copy } from "lucide-react";
import { useState } from "react";
import type { ParsedApiError } from "../lib/apiError";

function formatKvList(data: Record<string, unknown> | undefined): { key: string; value: string }[] {
  if (!data) return [];
  return Object.entries(data)
    .filter(([k]) => !k.startsWith("_"))
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
}: {
  error: ParsedApiError;
  /** Last client params (e.g. generate) when server omits request. */
  clientRequest?: Record<string, unknown>;
  title?: string;
}) {
  const [showTech, setShowTech] = useState(false);
  const request = error.request ?? clientRequest;
  const processing = error.processing;
  const debugPayload = error.raw ?? {
    ...error,
    headline: undefined,
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
      <h4 className="plan-error-title">{title}</h4>
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

      <details
        className="plan-error-tech"
        open={showTech}
        onToggle={(e) => setShowTech((e.target as HTMLDetailsElement).open)}
      >
        <summary>Technical details</summary>
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

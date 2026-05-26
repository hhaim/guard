import { Braces, Copy, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppState, type DevPanelTab } from "../context/AppStateContext";

type DeveloperPanelProps = {
  jsonText: string;
  onJsonTextChange: (text: string) => void;
  jsonError: string | null;
  onResetDefaults: () => void;
};

function useIsMobile(breakpoint = 768) {
  const [mobile, setMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia(`(max-width: ${breakpoint - 1}px)`).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const fn = () => setMobile(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, [breakpoint]);
  return mobile;
}

function statusBadge(status: number | "pending" | "error") {
  if (status === "pending") return { cls: "pending", label: "…" };
  if (status === "error") return { cls: "err", label: "ERR" };
  if (status >= 200 && status < 300) return { cls: "ok", label: String(status) };
  if (status >= 400) return { cls: "err", label: String(status) };
  return { cls: "pending", label: String(status) };
}

function RawResponseView({ data }: { data: unknown }) {
  const text =
    data == null ? "" : typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const lines = text.split("\n");
  if (!text) {
    return <p className="dev-empty">No response yet</p>;
  }
  return (
    <pre className="raw-response" aria-label="Raw API response">
      {lines.map((line, i) => (
        <span key={i} className="line">
          {line || " "}
        </span>
      ))}
    </pre>
  );
}

export function DevPanelTrigger({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      className="dev-trigger"
      aria-label="Open developer panel"
      onClick={() => onOpen()}
    >
      <Braces size={18} strokeWidth={2} />
      <span>{"{ }"}</span>
    </button>
  );
}

export function DeveloperPanel({
  jsonText,
  onJsonTextChange,
  jsonError,
  onResetDefaults,
}: DeveloperPanelProps) {
  const { apiLogs, lastRawResponse, panelOpen, setPanelOpen, activeTab, setActiveTab } = useAppState();
  const isMobile = useIsMobile();
  const [dragY, setDragY] = useState(0);
  const dragRef = useRef({ startY: 0, dragging: false });

  useEffect(() => {
    if (!panelOpen) setDragY(0);
  }, [panelOpen]);

  useEffect(() => {
    if (!panelOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [panelOpen]);

  const close = useCallback(() => setPanelOpen(false), [setPanelOpen]);

  const onTouchStart = (e: React.TouchEvent) => {
    dragRef.current = { startY: e.touches[0].clientY, dragging: true };
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!dragRef.current.dragging) return;
    const dy = Math.max(0, e.touches[0].clientY - dragRef.current.startY);
    setDragY(dy);
  };

  const onTouchEnd = () => {
    dragRef.current.dragging = false;
    if (dragY > 80) close();
    setDragY(0);
  };

  const formatJson = () => {
    try {
      const parsed = JSON.parse(jsonText) as unknown;
      onJsonTextChange(JSON.stringify(parsed, null, 2));
    } catch {
      /* invalid JSON — error shown inline */
    }
  };

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(jsonText);
    } catch {
      /* ignore */
    }
  };

  const panelStyle =
    isMobile && panelOpen ? { transform: `translateY(${dragY}px)` } : undefined;

  const tabs: { id: DevPanelTab; label: string }[] = [
    { id: "json", label: "JSON" },
    { id: "logs", label: "API Log" },
    { id: "response", label: "Response" },
  ];

  return (
    <>
      <PanelBackdrop open={panelOpen} onClose={close} />
      <aside
        className={`dev-panel ${isMobile ? "sheet" : "drawer"}${panelOpen ? " open" : ""}`}
        style={panelStyle}
        role="dialog"
        aria-modal="true"
        aria-label="Developer panel"
        aria-hidden={!panelOpen}
      >
        {isMobile && (
          <div
            className="dev-sheet-handle"
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          >
            <span />
          </div>
        )}
        <header className="dev-panel-header">
          <div className="dev-tabs" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={activeTab === t.id}
                className={`dev-tab${activeTab === t.id ? " active" : ""}`}
                onPointerDown={(e) => {
                  e.preventDefault();
                  setActiveTab(t.id);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="dev-close"
            aria-label="Close developer panel"
            onPointerDown={(e) => {
              e.preventDefault();
              close();
            }}
          >
            <X size={20} strokeWidth={2} />
          </button>
        </header>
        <div className="dev-panel-body" data-tab={activeTab}>
          {activeTab === "json" && (
            <>
              <div className="dev-toolbar">
                <button type="button" className="btn btn-tinted" onPointerDown={() => formatJson()}>
                  Format
                </button>
                <button type="button" className="btn btn-tinted" onPointerDown={() => copyJson()}>
                  <Copy size={16} strokeWidth={2} />
                  Copy
                </button>
                <button type="button" className="btn btn-tinted" onPointerDown={() => onResetDefaults()}>
                  <RotateCcw size={16} strokeWidth={2} />
                  Reset
                </button>
              </div>
              <textarea
                className="dev-json-editor"
                value={jsonText}
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                onChange={(e) => onJsonTextChange(e.target.value)}
                aria-label="JSON editor"
              />
              {jsonError && <p className="dev-json-error">{jsonError}</p>}
            </>
          )}
          {activeTab === "logs" && (
            <div className="log-list">
              {apiLogs.length === 0 ? (
                <p className="dev-empty">No API calls yet</p>
              ) : (
                apiLogs.map((log) => {
                  const badge = statusBadge(log.status);
                  return (
                    <details key={log.id} className="log-entry">
                      <summary>
                        <span className="log-ts">{log.ts.toLocaleTimeString()}</span>
                        <span className="log-method">{log.method}</span>
                        <span className="log-endpoint">{log.endpoint}</span>
                        <span className={`log-badge ${badge.cls}`}>{badge.label}</span>
                        {log.latency != null && <span className="log-ts">{log.latency}ms</span>}
                      </summary>
                      {log.request != null && (
                        <pre className="log-body">
                          Request:{"\n"}
                          {JSON.stringify(log.request, null, 2)}
                        </pre>
                      )}
                      {log.response != null && (
                        <pre className="log-body">
                          Response:{"\n"}
                          {JSON.stringify(log.response, null, 2)}
                        </pre>
                      )}
                      {log.error && <pre className="log-body">Error: {log.error}</pre>}
                    </details>
                  );
                })
              )}
            </div>
          )}
          {activeTab === "response" && <RawResponseView data={lastRawResponse} />}
        </div>
      </aside>
    </>
  );
}

function PanelBackdrop({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <div
      className={`dev-backdrop${open ? " open" : ""}`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-hidden={!open}
    />
  );
}

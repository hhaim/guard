import { Copy, HelpCircle, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EXPERT_RULES_EXAMPLES } from "../lib/expertRulesExamples";
import {
  applyAutocompleteSuggestion,
  autocompleteSuggestions,
  highlightLineParts,
  joinEditorLines,
  lineIndexFromParseError,
  splitEditorLines,
  type ExpertSuggestions,
} from "../lib/expertRulesModel";

export type ExpertRulesEditorProps = {
  value: string;
  onChange: (text: string) => void;
  disabled?: boolean;
  parseError?: string | null;
  suggestions: ExpertSuggestions;
  onOpenHelp?: () => void;
};

function ExamplesSheet({
  onClose,
  onAppend,
  onOpenHelp,
}: {
  onClose: () => void;
  onAppend: (line: string) => void;
  onOpenHelp?: () => void;
}) {
  return (
    <div className="contacts-sheet-backdrop" role="presentation" onPointerDown={onClose}>
      <div
        className="contacts-edit-sheet expert-rules-help-sheet"
        role="dialog"
        aria-modal="true"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="contacts-sheet-nav">
          <button type="button" className="contacts-nav-btn" onPointerDown={onClose}>
            Done
          </button>
          <h2 className="contacts-sheet-title">Rule examples</h2>
          {onOpenHelp ? (
            <button type="button" className="contacts-nav-btn contacts-nav-btn-primary" onPointerDown={onOpenHelp}>
              Guide
            </button>
          ) : (
            <span className="expert-rules-nav-spacer" aria-hidden />
          )}
        </header>
        <ul className="expert-rules-example-list">
          {EXPERT_RULES_EXAMPLES.map((ex) => (
            <li key={ex.line}>
              <button
                type="button"
                className="expert-rules-example-item"
                onClick={() => {
                  onAppend(ex.line);
                  onClose();
                }}
              >
                <code className="expert-rules-example-line">{ex.line}</code>
                <span className="expert-rules-example-title">{ex.title}</span>
                <span className="contacts-hint expert-rules-example-help">{ex.help}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function LineHighlight({ line }: { line: string }) {
  const parts = highlightLineParts(line);
  return (
    <>
      {parts.map((p, i) => (
        <span key={i} className={`expert-rules-hl-${p.kind}`}>
          {p.text}
        </span>
      ))}
    </>
  );
}

function RuleLineRow({
  line,
  lineIndex,
  disabled,
  isError,
  isActive,
  suggestions,
  onFocus,
  onLineChange,
  onDuplicate,
  onRemove,
}: {
  line: string;
  lineIndex: number;
  disabled?: boolean;
  isError?: boolean;
  isActive: boolean;
  suggestions: ExpertSuggestions;
  onFocus: (index: number, caret: number) => void;
  onLineChange: (index: number, next: string, caret?: number) => void;
  onDuplicate: (index: number) => void;
  onRemove: (index: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className={`expert-rules-line${isError ? " expert-rules-line--error" : ""}${isActive ? " expert-rules-line--active" : ""}`}
    >
      <div className="expert-rules-line-gutter">
        <button
          type="button"
          className="expert-rules-btn-xs"
          disabled={disabled}
          title="Duplicate line"
          aria-label={`Duplicate line ${lineIndex + 1}`}
          onClick={() => onDuplicate(lineIndex)}
        >
          <Copy size={14} aria-hidden />
        </button>
        <button
          type="button"
          className="expert-rules-btn-xs"
          disabled={disabled}
          title="Remove line"
          aria-label={`Remove line ${lineIndex + 1}`}
          onClick={() => onRemove(lineIndex)}
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </div>
      <div className="expert-rules-line-field">
        <div className="expert-rules-line-hl" aria-hidden>
          <LineHighlight line={line} />
        </div>
        <input
          ref={inputRef}
          type="text"
          className="expert-rules-line-input"
          value={line}
          disabled={disabled}
          list={isActive ? "expert-rules-shared-datalist" : undefined}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          inputMode="text"
          aria-label={`Rule line ${lineIndex + 1}`}
          onFocus={(e) => onFocus(lineIndex, e.target.selectionStart ?? line.length)}
          onClick={(e) => onFocus(lineIndex, e.currentTarget.selectionStart ?? line.length)}
          onKeyUp={(e) => onFocus(lineIndex, e.currentTarget.selectionStart ?? line.length)}
          onChange={(e) => {
            const caret = e.target.selectionStart ?? e.target.value.length;
            onLineChange(lineIndex, e.target.value, caret);
            onFocus(lineIndex, caret);
          }}
        />
      </div>
    </div>
  );
}

export function ExpertRulesEditor({
  value,
  onChange,
  disabled,
  parseError,
  suggestions,
  onOpenHelp,
}: ExpertRulesEditorProps) {
  const [lines, setLines] = useState(() => splitEditorLines(value));
  const [activeLine, setActiveLine] = useState(0);
  const [caret, setCaret] = useState(0);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const lastEmitted = useRef(value);
  const pendingCaret = useRef<{ line: number; pos: number } | null>(null);

  useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    setLines(splitEditorLines(value));
  }, [value]);

  const emit = useCallback(
    (nextLines: string[]) => {
      setLines(nextLines);
      const text = joinEditorLines(nextLines);
      lastEmitted.current = text;
      onChange(text);
    },
    [onChange]
  );

  useEffect(() => {
    const pending = pendingCaret.current;
    if (!pending) return;
    pendingCaret.current = null;
    const row = document.querySelector<HTMLInputElement>(
      `.expert-rules-line:nth-child(${pending.line + 1}) .expert-rules-line-input`
    );
    if (row) {
      row.focus();
      row.setSelectionRange(pending.pos, pending.pos);
    }
  });

  const errorLineIndex = useMemo(
    () => (parseError ? lineIndexFromParseError(parseError, lines) : null),
    [parseError, lines]
  );

  const acSuggestions = useMemo(() => {
    if (activeLine < 0 || activeLine >= lines.length) return [];
    return autocompleteSuggestions(lines[activeLine] ?? "", caret, suggestions);
  }, [activeLine, caret, lines, suggestions]);

  const updateLine = (index: number, next: string, nextCaret?: number) => {
    const copy = [...lines];
    copy[index] = next;
    emit(copy);
    if (nextCaret != null) setCaret(nextCaret);
  };

  const insertExampleLine = (text: string) => {
    const copy = [...lines];
    const idx = activeLine >= 0 && activeLine < copy.length ? activeLine : copy.length - 1;
    const current = copy[idx] ?? "";
    if (!current.trim()) {
      copy[idx] = text;
    } else {
      copy.splice(idx + 1, 0, text);
    }
    emit(copy);
    setActiveLine(!current.trim() ? idx : idx + 1);
  };

  const applySuggestion = (pick: string) => {
    const line = lines[activeLine] ?? "";
    const { line: next, caret: nextCaret } = applyAutocompleteSuggestion(line, caret, pick);
    updateLine(activeLine, next, nextCaret);
    pendingCaret.current = { line: activeLine, pos: nextCaret };
  };

  return (
    <div className="expert-rules-editor" dir="ltr">
      <div className="expert-rules-toolbar">
        <button
          type="button"
          className="expert-rules-btn-xs"
          disabled={disabled}
          title="Examples and help"
          aria-label="Examples and help"
          onClick={() => setExamplesOpen(true)}
        >
          <HelpCircle size={16} aria-hidden />
        </button>
        <button
          type="button"
          className="expert-rules-btn-xs"
          disabled={disabled}
          title="Add line"
          aria-label="Add line"
          onClick={() => {
            emit([...lines, ""]);
            setActiveLine(lines.length);
          }}
        >
          <Plus size={16} aria-hidden />
        </button>
        <button
          type="button"
          className="expert-rules-btn-xs"
          disabled={disabled}
          title="Clear all"
          aria-label="Clear all"
          onClick={() => {
            if (lines.some((l) => l.trim()) && !window.confirm("Clear all rules?")) return;
            emit([""]);
            setActiveLine(0);
          }}
        >
          <Trash2 size={16} aria-hidden />
        </button>
      </div>

      {acSuggestions.length > 0 ? (
        <div className="expert-rules-ac-strip" role="listbox" aria-label="Suggestions">
          {acSuggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="expert-rules-ac-chip"
              role="option"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applySuggestion(s)}
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}

      <datalist id="expert-rules-shared-datalist">
        {acSuggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      <div className="expert-rules-lines">
        {lines.map((line, i) => (
          <RuleLineRow
            key={i}
            line={line}
            lineIndex={i}
            disabled={disabled}
            isError={errorLineIndex === i}
            isActive={activeLine === i}
            suggestions={suggestions}
            onFocus={(idx, c) => {
              setActiveLine(idx);
              setCaret(c);
            }}
            onLineChange={updateLine}
            onDuplicate={(idx) => {
              const copy = [...lines];
              copy.splice(idx + 1, 0, lines[idx] ?? "");
              emit(copy);
              setActiveLine(idx + 1);
            }}
            onRemove={(idx) => {
              if (lines.length <= 1) {
                emit([""]);
                return;
              }
              const copy = lines.filter((_, j) => j !== idx);
              emit(copy);
              setActiveLine(Math.min(idx, copy.length - 1));
            }}
          />
        ))}
      </div>

      {examplesOpen ? (
        <ExamplesSheet
          onClose={() => setExamplesOpen(false)}
          onAppend={insertExampleLine}
          onOpenHelp={
            onOpenHelp
              ? () => {
                  setExamplesOpen(false);
                  onOpenHelp();
                }
              : undefined
          }
        />
      ) : null}
    </div>
  );
}

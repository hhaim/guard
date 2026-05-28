import { useEffect, useRef, useState } from "react";

const PARTIAL_DECIMAL = /^-?\d*\.?\d*$/;

export function formatDecimalDisplay(n: number): string {
  if (!Number.isFinite(n)) return "";
  return String(n);
}

type DecimalNumFieldProps = {
  label: string;
  hint?: string;
  value: number;
  onChange: (n: number) => void;
  inputClassName?: string;
};

/** Numeric input that accepts fractional values (e.g. 0.1, 1.5) without eating "." while typing. */
export function DecimalNumField({ label, hint, value, onChange, inputClassName }: DecimalNumFieldProps) {
  const [text, setText] = useState(() => formatDecimalDisplay(value));
  const focused = useRef(false);

  useEffect(() => {
    if (focused.current) return;
    setText(formatDecimalDisplay(value));
  }, [value]);

  const commit = (raw: string) => {
    const n = Number(raw);
    if (Number.isFinite(n)) {
      onChange(n);
      setText(formatDecimalDisplay(n));
      return;
    }
    setText(formatDecimalDisplay(value));
  };

  return (
    <div className="settings-row">
      <label className="settings-row-label">
        <span className="title">{label}</span>
        {hint ? <span className="hint">{hint}</span> : null}
      </label>
      <input
        className={inputClassName ?? "settings-input settings-input-wide"}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={text}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
          commit(text);
        }}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "" || v === "-") {
            setText(v);
            return;
          }
          if (!PARTIAL_DECIMAL.test(v)) return;
          setText(v);
          if (!v.endsWith(".") && v !== "-") {
            const n = Number(v);
            if (Number.isFinite(n)) onChange(n);
          }
        }}
      />
    </div>
  );
}

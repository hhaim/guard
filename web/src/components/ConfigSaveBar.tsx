import { Save } from "lucide-react";

type ConfigSaveBarProps = {
  label: string;
  dirty: boolean;
  disabled: boolean;
  pending: boolean;
  error?: string | null;
  success?: boolean;
  onSave: () => void;
  onDiscard?: () => void;
};

export function ConfigSaveBar({
  label,
  dirty,
  disabled,
  pending,
  error,
  success,
  onSave,
  onDiscard,
}: ConfigSaveBarProps) {
  return (
    <>
      <div className="btn-row">
        <button
          type="button"
          className="btn btn-filled"
          disabled={disabled || pending || !dirty}
          onPointerDown={(e) => {
            e.preventDefault();
            onSave();
          }}
        >
          <Save size={18} strokeWidth={2} />
          {label}
        </button>
        {dirty && onDiscard && (
          <button
            type="button"
            className="btn btn-plain"
            onPointerDown={(e) => {
              e.preventDefault();
              onDiscard();
            }}
          >
            Discard
          </button>
        )}
      </div>
      {error && <p className="msg-err">{error}</p>}
      {success && <p className="msg-ok">Saved.</p>}
    </>
  );
}

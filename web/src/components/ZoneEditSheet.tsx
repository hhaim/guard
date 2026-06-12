import type { ReactNode } from "react";

type ZoneEditSheetProps = {
  open: boolean;
  title: string;
  canDone: boolean;
  onDone: () => void;
  onCancel: () => void;
  children: ReactNode;
  footer?: ReactNode;
};

export function ZoneEditSheet({
  open,
  title,
  canDone,
  onDone,
  onCancel,
  children,
  footer,
}: ZoneEditSheetProps) {
  if (!open) return null;
  return (
    <div className="contacts-sheet-backdrop" role="presentation" onPointerDown={onCancel}>
      <div
        className="contacts-edit-sheet"
        role="dialog"
        aria-modal="true"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="contacts-sheet-nav">
          <button type="button" className="contacts-nav-btn" onPointerDown={() => onCancel()}>
            Cancel
          </button>
          <h2 className="contacts-sheet-title">{title}</h2>
          <button
            type="button"
            className="contacts-nav-btn contacts-nav-btn-primary"
            disabled={!canDone}
            onPointerDown={() => canDone && onDone()}
          >
            Done
          </button>
        </header>
        <div className="contacts-editor-fields-wrap">{children}</div>
        {footer}
      </div>
    </div>
  );
}

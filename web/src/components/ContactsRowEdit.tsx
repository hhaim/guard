import { ChevronRight } from "lucide-react";

/** Explicit edit control for contacts-style tables (tap), separate from row double-click. */
export function ContactsRowEditButton({
  onEdit,
  label = "Edit",
}: {
  onEdit: () => void;
  label?: string;
}) {
  return (
    <td className="contacts-chevron">
      <button
        type="button"
        className="contacts-edit-btn"
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
      >
        <ChevronRight size={18} strokeWidth={2} aria-hidden />
      </button>
    </td>
  );
}

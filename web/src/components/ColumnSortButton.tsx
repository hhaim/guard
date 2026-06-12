import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

export type SortDirection = "asc" | "desc";

type ColumnSortButtonProps = {
  label: string;
  active: boolean;
  direction: SortDirection;
  onToggle: () => void;
};

export function ColumnSortButton({ label, active, direction, onToggle }: ColumnSortButtonProps) {
  const Icon = !active ? ArrowUpDown : direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      className={`column-sort-btn${active ? " column-sort-btn-active" : ""}`}
      aria-label={
        active
          ? `Sorted by ${label} ${direction === "asc" ? "ascending" : "descending"}. Click to reverse.`
          : `Sort by ${label}`
      }
      onClick={onToggle}
    >
      <Icon size={14} strokeWidth={2} />
    </button>
  );
}

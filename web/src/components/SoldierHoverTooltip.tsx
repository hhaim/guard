import type { ReactNode } from "react";

type Props = {
  lines: string[];
  children: ReactNode;
  className?: string;
  /** Tooltip opens to the left of the trigger (useful for right-edge matrix cells). */
  placement?: "left" | "right";
};

/** Hover/focus tooltip with multiline short-key soldier info. */
export function SoldierHoverTooltip({ lines, children, className, placement = "right" }: Props) {
  if (lines.length === 0) return <>{children}</>;
  const text = lines.join("\n");
  const placementClass = placement === "left" ? " is-left" : "";
  return (
    <span
      className={`sched-soldier-tooltip-wrap${placementClass}${className ? ` ${className}` : ""}`}
    >
      {children}
      <span className="sched-soldier-tooltip" role="tooltip">
        {lines.map((line, i) => (
          <span key={i} className="sched-soldier-tooltip-line">
            {line}
          </span>
        ))}
      </span>
      <span className="sr-only">{text}</span>
    </span>
  );
}

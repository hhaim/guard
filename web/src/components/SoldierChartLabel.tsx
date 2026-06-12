import { buildSoldierProfileTooltip } from "../lib/soldierTooltip";
import type { SoldierDisplay } from "../lib/soldierDisplay";
import type { Soldier } from "../lib/soldiers";
import type { SoldierTypesDoc } from "../lib/soldierTypes";
import { SoldierHoverTooltip } from "./SoldierHoverTooltip";

function soldierDisplayName(
  soldierIdx: number,
  nameById: Map<string, string>,
  display: SoldierDisplay,
  soldierIds: string[],
): string | undefined {
  const rosterId = soldierIds[soldierIdx]?.trim();
  if (rosterId) {
    const fromRosterId = nameById.get(rosterId);
    if (fromRosterId) return fromRosterId;
  }
  const fromIdx = display.fullLabel(soldierIdx);
  const short = display.shortLabel(soldierIdx);
  if (fromIdx && fromIdx !== short) return fromIdx;
  return undefined;
}

type Props = {
  soldierIdx: number;
  display: SoldierDisplay;
  nameById: Map<string, string>;
  soldierIds: string[];
  soldiers: Soldier[];
  typesDoc?: SoldierTypesDoc;
  rawHoursBySlot?: number[];
};

/** Timeline-style platoon badge + padded soldier id (S01). */
export function SoldierChartLabel({
  soldierIdx,
  display,
  nameById,
  soldierIds,
  soldiers,
  typesDoc,
  rawHoursBySlot,
}: Props) {
  const short = display.shortLabel(soldierIdx);
  const name = soldierDisplayName(soldierIdx, nameById, display, soldierIds);
  const tooltipLines =
    rawHoursBySlot != null
      ? buildSoldierProfileTooltip(soldierIdx, rawHoursBySlot, soldierIds, soldiers, typesDoc)
      : [];

  const label = (
    <span
      className="sched-timeline-label sched-soldier-badge"
      style={display.badgeStyle(soldierIdx)}
      aria-label={name ? `${short}, ${name}` : short}
      tabIndex={tooltipLines.length > 0 ? 0 : undefined}
    >
      <span>{short}</span>
    </span>
  );

  if (tooltipLines.length > 0) {
    return <SoldierHoverTooltip lines={tooltipLines}>{label}</SoldierHoverTooltip>;
  }
  return label;
}

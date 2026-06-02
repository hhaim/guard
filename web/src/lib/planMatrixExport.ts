import { resolvePlanDayStartHour } from "./planDay";
import type { PlanDoc } from "./planDoc";
import type { PlatoonColorEntry } from "./platoonColors";
import {
  buildScheduleMatrices,
  buildZoneReportView,
  inferSoldierCount,
  MATRIX_CELL_MAX_SOLDIERS,
  type MatrixCell,
  type MatrixDay,
} from "./scheduleReport";
import { downloadTextFile } from "./scheduleExport";
import { buildSoldierDisplay, type SoldierDisplay } from "./soldierDisplay";
import type { Soldier } from "./soldiers";
import { countEnabledSlots, type ZonesDoc } from "./zones";

export type PlanMatrixExportInput = {
  plan: PlanDoc;
  zones: ZonesDoc;
  soldierIds: string[];
  soldiers: Soldier[];
  platoonColors?: PlatoonColorEntry[];
};

const XLS_MIME = "application/vnd.ms-excel;charset=utf-8";

function esc(s: string | number | undefined | null): string {
  const t = s == null ? "" : String(s);
  return t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function matrixCellSoldierIndices(cell: MatrixCell): number[] {
  return cell.soldierIndices ?? (cell.soldierIdx != null && cell.soldierIdx >= 0 ? [cell.soldierIdx] : []);
}

function matrixCellBackgroundStyle(
  cell: MatrixCell,
  display: SoldierDisplay,
): { backgroundColor: string } | undefined {
  const indices = matrixCellSoldierIndices(cell);
  if (indices.length === 0) return undefined;
  return display.matrixCellStyle(indices[0]);
}

function matrixCellInnerHtml(cell: MatrixCell, display: SoldierDisplay): string {
  if (cell.disabled) {
    return esc("—");
  }
  const indices = matrixCellSoldierIndices(cell);
  if (indices.length === 0) {
    return esc(cell.label || "—");
  }
  const labels = indices.map((idx) => display.fullLabel(idx));
  const badge = (idx: number, label: string) => {
    const st = display.matrixBadgeStyle(idx);
    return `<span style="color:${esc(st.color)}">${esc(label)}</span>`;
  };
  if (indices.length > 1) {
    const show = indices.slice(0, MATRIX_CELL_MAX_SOLDIERS);
    const showLabels = labels.slice(0, MATRIX_CELL_MAX_SOLDIERS);
    const extra = indices.length - show.length;
    const parts = show.map((idx, i) => badge(idx, showLabels[i] ?? display.fullLabel(idx)));
    const more = extra > 0 ? ` (+${extra} more)` : "";
    return parts.join(" ") + esc(more);
  }
  return badge(indices[0], labels[0] ?? display.fullLabel(indices[0]));
}

function matrixTableHtml(matrix: MatrixDay, display: SoldierDisplay): string {
  const head = matrix.headers
    .map(
      (h) =>
        `<th>Slot ${h.slot}<br/>${esc(h.label)} (${esc(h.locId)})</th>`,
    )
    .join("");
  const body = matrix.rows
    .map((row) => {
      const cells = row.cells
        .map((cell) => {
          if (cell.skip) return "";
          const bg = matrixCellBackgroundStyle(cell, display);
          const styleAttr = bg ? ` style="background-color:${bg.backgroundColor}"` : "";
          const rs = cell.rowspan && cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : "";
          const inner = matrixCellInnerHtml(cell, display);
          return `<td${styleAttr}${rs}>${inner}</td>`;
        })
        .join("");
      return `<tr><th scope="row">${esc(row.window)}</th>${cells}</tr>`;
    })
    .join("");
  return `<table border="1" cellspacing="0" cellpadding="4">
<thead><tr><th>Time shift</th>${head}</tr></thead>
<tbody>${body}</tbody>
</table>`;
}

/** Matrix tables only (full names, platoon cell colors) for Excel HTML import. */
export function buildPlanMatrixXlsHtml(input: PlanMatrixExportInput): string {
  const { plan, zones, soldierIds, soldiers, platoonColors = [] } = input;
  const assignments = plan.assignments;
  const days = plan.days;
  const shiftHours = plan.shift_hours;
  const planDayStartHour = resolvePlanDayStartHour(plan.meta);
  const anchorDate = plan.anchor_date;
  const rawVerified = plan.meta?.verified_dates;
  const verifiedDates = Array.isArray(rawVerified)
    ? rawVerified.filter((d): d is string => typeof d === "string" && d.length >= 10)
    : undefined;

  const slotsPerBlock = countEnabledSlots(zones);
  const zone = buildZoneReportView(zones, slotsPerBlock);
  if (shiftHours > 0) {
    zone.shiftHours = shiftHours;
    zone.blocksPerDay = Math.round(24 / shiftHours);
  }
  const soldierCount = inferSoldierCount(assignments);
  const display = buildSoldierDisplay(soldierIds, soldiers, soldierCount, platoonColors);
  const matrices = buildScheduleMatrices(assignments, days, zone, {
    planDayStartHour,
    anchorDate,
    verifiedDates,
    soldierIds,
  });

  const tables = matrices.map((m) => matrixTableHtml(m, display)).join("\n<br/>\n");

  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:x="urn:schemas-microsoft-com:office:excel"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8"/>
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
<x:Name>Schedule</x:Name>
<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
</head>
<body>${tables}</body>
</html>`;
}

export function planMatrixXlsFilenameForProposal(anchor: string, slot: string): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return `guard-plan-${safe(anchor)}-proposal-${safe(slot)}.xls`;
}

export function planMatrixXlsFilenameForScheduleDay(calendarDate: string): string {
  const safe = calendarDate.replace(/[^0-9-]+/g, "");
  return `guard-schedule-${safe || "day"}.xls`;
}

export function downloadPlanMatrixXls(input: PlanMatrixExportInput, filename: string): void {
  const html = buildPlanMatrixXlsHtml(input);
  downloadTextFile(filename, html, XLS_MIME);
}

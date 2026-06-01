import { formatWallClockHour, resolvePlanDayStartHour, timelineChartLayout } from "./planDay";
import type { PlanChange, PlanDoc } from "./planDoc";
import type { Soldier } from "../lib/soldiers";
import {
  buildBusyTensor,
  buildScheduleMatrices,
  buildScheduleStats,
  buildSoldierBlockRows,
  buildTimelineLanes,
  buildZoneReportView,
  formatMatrixCellLabels,
  inferSoldierCount,
  MATRIX_CELL_MAX_SOLDIERS,
  reportFutureExtensionBlocks,
  timelineSegmentKind,
  type MatrixDay,
} from "./scheduleReport";
import { buildSoldierDisplay, type SoldierDisplay } from "./soldierDisplay";
import {
  buildPlanAvailabilityReport,
  classificationLabel,
  formatAvailabilityWindows,
} from "./planSoldierAvailability";
import { countEnabledSlots, type ZonesDoc } from "./zones";

export type PlanReportInput = {
  proposal: PlanDoc;
  slot: string;
  zones: ZonesDoc;
  soldierIds: string[];
  soldiers: Soldier[];
  effectiveToday?: string;
};

function esc(s: string | number | undefined | null): string {
  const t = s == null ? "" : String(s);
  return t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Match planPdfExport SHEET_WIDTH_PX for canvas capture. */
const SHEET_WIDTH_PX = 1122;

/** Styles aligned with web/src/styles/components.css (.sched-*). */
const REPORT_CSS = `
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 12px;
    line-height: 1.4;
    color: #1c1c1e;
    margin: 0;
    padding: 0;
    background: #fff;
  }
  h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 8px; }
  .meta { color: #636366; margin: 0 0 12px; font-size: 11px; }
  .meta strong { color: #1c1c1e; }
  @page { size: A4 landscape; margin: 8mm; }
  .pdf-cover,
  .pdf-page {
    width: ${SHEET_WIDTH_PX}px;
    max-width: ${SHEET_WIDTH_PX}px;
    margin: 0 auto;
    background: #fff;
  }
  .pdf-cover {
    padding: 14px 16px 10px;
    page-break-after: always;
    break-after: page;
  }
  .pdf-page {
    page-break-before: always;
    break-before: page;
    padding: 8px 16px 12px;
    page-break-inside: avoid;
  }
  .pdf-page .sched-subtitle {
    font-size: 13px;
    font-weight: 600;
    margin: 0 0 6px;
    padding: 0;
  }
  .sched-section-title {
    font-size: 1rem; font-weight: 600; margin: 0 0 6px;
    padding: 0 0 4px; border-bottom: 1px solid rgba(60, 60, 67, 0.12);
  }
  .sched-hint { font-size: 11px; color: #636366; margin: 0 0 6px; line-height: 1.4; }
  .sched-matrix-block { margin: 0; page-break-inside: avoid; }
  .page-break-before { page-break-before: always; break-before: page; }
  .sched-table-scroll {
    border: 1px solid rgba(60, 60, 67, 0.12);
    border-radius: 8px;
    overflow: hidden;
    margin: 0;
  }
  .sched-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
    table-layout: auto;
  }
  .sched-matrix-table { table-layout: fixed; min-width: 520px; }
  .sched-soldier-table { min-width: 680px; }
  .sched-table th,
  .sched-table td {
    border: 1px solid rgba(60, 60, 67, 0.18);
    padding: 6px 8px;
    text-align: center;
    vertical-align: middle;
    word-wrap: break-word;
  }
  .sched-table th:first-child,
  .sched-table td:first-child,
  .sched-table th[scope="row"] {
    text-align: left;
    font-weight: 600;
    background: rgba(120, 120, 128, 0.06);
    width: 14%;
  }
  .sched-table thead th {
    background: rgba(120, 120, 128, 0.1);
    font-weight: 600;
  }
  .sched-th-sub {
    display: block;
    font-weight: 400;
    font-size: 10px;
    color: #636366;
    margin-top: 2px;
  }
  .sched-soldier-badge {
    display: inline-block;
    padding: 3px 8px;
    border-radius: 4px;
    font-weight: 600;
    line-height: 1.35;
    border: 1px solid rgba(0, 0, 0, 0.06);
    white-space: nowrap;
  }
  .sched-matrix-disabled { color: #8e8e93; }
  .sched-matrix-cell-team {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    page-break-inside: avoid;
  }
  .sched-matrix-cell-team .sched-soldier-badge {
    font-size: 0.75rem;
    white-space: normal;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  .sched-soldier-title-badge { font-size: 13px; text-decoration: none; }
  .sched-soldier-page {
    margin: 0;
    padding: 0 16px;
    page-break-inside: avoid;
  }
  tr.sched-row-free td { background: rgba(46, 125, 50, 0.06); }
  tr.sched-row-rest td { background: rgba(74, 20, 140, 0.06); }
  .sched-row-rest .sched-rest-cell {
    font-weight: 600;
    color: #4a148c;
  }
  .sched-row-free .sched-free-cell {
    font-weight: 600;
    color: #1b5e20;
    font-style: normal;
  }
  .sched-changes-table { table-layout: auto; min-width: 0; }
  .sched-stats-block {
    margin: 0;
    page-break-inside: avoid;
  }
  .sched-stats-block .sched-subtitle { margin-top: 0; }
  .sched-stats-table {
    table-layout: auto;
    font-size: 11px;
    min-width: 0;
  }
  .sched-stats-table th,
  .sched-stats-table td {
    padding: 7px 9px;
    font-size: 11px;
  }
  .sched-stats-table thead th {
    background: rgba(120, 120, 128, 0.14);
    font-size: 10px;
    line-height: 1.3;
    vertical-align: bottom;
  }
  .sched-stats-table tbody th[scope="row"] {
    text-align: left;
    min-width: 88px;
    max-width: 140px;
  }
  .sched-stats-table--wide { font-size: 10px; }
  .sched-stats-table--wide th,
  .sched-stats-table--wide td { padding: 6px 7px; font-size: 10px; }
  .sched-stats-fairness {
    padding: 10px 12px;
    border: 1px solid rgba(60, 60, 67, 0.12);
    border-radius: 8px;
    background: rgba(120, 120, 128, 0.04);
  }
  .sched-global-list {
    list-style: none; margin: 0.35rem 0 0; padding: 0; font-size: 11px;
    display: grid; gap: 6px; grid-template-columns: 1fr 1fr;
  }
  .sched-global-k { color: #636366; margin-right: 4px; }
  .sched-timeline-wrap { margin: 12px 0; }
  .sched-timeline-bar {
    position: relative;
    height: 18px;
    background: rgba(120, 120, 128, 0.06);
    border-radius: 2px;
    margin: 4px 0 4px 88px;
  }
  .sched-timeline-label {
    position: absolute;
    left: 0;
    width: 84px;
    font-size: 10px;
    font-weight: 600;
    line-height: 18px;
    text-align: right;
    padding-right: 6px;
  }
  .seg { position: absolute; top: 1px; bottom: 1px; border-radius: 1px; }
  .seg-on { background: #c62828; }
  .seg-full-day { background: #d84315; }
  .seg-off { background: #2e7d32; }
  .seg-unavail { background: #f9a825; }
  .sched-availability-day { margin: 0 0 14px; }
  .sched-availability-table { min-width: 520px; }
  .sched-avail-row--full td:nth-child(2) { color: #1b5e20; font-weight: 600; }
  .sched-avail-row--partial td:nth-child(2) { color: #9a6b00; font-weight: 600; }
  .sched-avail-row--absent_full td:nth-child(2) { color: #b71c1c; font-weight: 600; }
  .availability-badge {
    display: inline-block;
    min-width: 1.6rem;
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: 700;
    font-size: 11px;
    text-align: center;
  }
  .availability-badge--full { background: #d1fae5; color: #065f46; }
  .availability-badge--absent { background: #fecdd3; color: #881337; }
  .availability-badge--partial { background: #fef3c7; color: #78350f; }
  .availability-badges-row { display: flex; gap: 6px; margin: 4px 0 8px; }
  @media print {
    body { padding: 0; }
    .pdf-page,
    .page-break-before { page-break-before: always; break-before: page; }
    .pdf-page,
    .sched-matrix-block,
    .sched-soldier-page,
    .sched-stats-block { page-break-inside: avoid; }
  }
`;

function soldierBadgeHtml(
  soldierIdx: number,
  label: string,
  display: SoldierDisplay,
  extraClass = ""
): string {
  const st = display.badgeStyle(soldierIdx);
  const cls = extraClass ? `sched-soldier-badge ${extraClass}` : "sched-soldier-badge";
  return `<span class="${cls}" style="background-color:${st.backgroundColor};color:${st.color}">${esc(label)}</span>`;
}

function matrixCellHtml(
  cell: MatrixDay["rows"][0]["cells"][0],
  labelForIdx: (idx: number) => string,
  display: SoldierDisplay,
  useFullNames?: boolean
): string {
  if (cell.disabled) {
    return `<span class="sched-matrix-disabled">—</span>`;
  }
  const indices =
    cell.soldierIndices ?? (cell.soldierIdx != null && cell.soldierIdx >= 0 ? [cell.soldierIdx] : []);
  if (indices.length === 0) {
    return esc(cell.label);
  }
  const labels =
    cell.labels ??
    indices.map((idx) => (useFullNames ? display.fullLabel(idx) : labelForIdx(idx)));
  if (indices.length > 1) {
    const show = indices.slice(0, MATRIX_CELL_MAX_SOLDIERS);
    const showLabels = labels.slice(0, MATRIX_CELL_MAX_SOLDIERS);
    const extra = indices.length - show.length;
    const badges = show
      .map((idx, i) => soldierBadgeHtml(idx, showLabels[i] ?? labelForIdx(idx), display))
      .join("");
    const more = extra > 0 ? `<span class="sched-matrix-cell-more"> (+${extra} more)</span>` : "";
    return `<div class="sched-matrix-cell-team" title="${esc(formatMatrixCellLabels(indices, labels))}">${badges}${more}</div>`;
  }
  return soldierBadgeHtml(indices[0], labels[0] ?? labelForIdx(indices[0]), display);
}

function matrixTableHtml(
  matrix: MatrixDay,
  labelForIdx: (idx: number) => string,
  display: SoldierDisplay,
  subtitle: string,
  useFullNames = false
): string {
  const head = matrix.headers
    .map(
      (h) =>
        `<th>Slot ${h.slot}<span class="sched-th-sub">${esc(h.label)} (${esc(h.locId)})</span></th>`
    )
    .join("");
  const body = matrix.rows
    .map((row) => {
      const cells = row.cells
        .map((cell, j) => {
          if (cell.skip) return "";
          const team =
            (cell.soldierIndices?.length ?? 0) > 1 ? ' class="sched-matrix-td-team"' : "";
          const inner = matrixCellHtml(cell, labelForIdx, display, useFullNames);
          const rs = cell.rowspan && cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : "";
          return `<td${team}${rs}>${inner}</td>`;
        })
        .join("");
      return `<tr><th scope="row">${esc(row.window)}</th>${cells}</tr>`;
    })
    .join("");
  return `<div class="pdf-page sched-matrix-block">
    <h3 class="sched-subtitle">${esc(subtitle)}</h3>
    <div class="sched-table-scroll">
      <table class="sched-table sched-matrix-table">
        <thead><tr><th>Time shift</th>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  </div>`;
}

function changesTableHtml(changes: PlanChange[]): string {
  if (!changes.length) return "<p class=\"sched-hint\">No manual swap rows recorded.</p>";
  const rows = changes
    .map(
      (c, i) =>
        `<tr>
          <td>${i + 1}</td>
          <td>${esc(c.ts_date)}</td>
          <td>${esc(c.slot)}</td>
          <td>${esc(c.shift_label ?? String(c.shift_index))}</td>
          <td>${esc(c.old_soldier_id)}</td>
          <td>${esc(c.new_soldier_id)}</td>
        </tr>`
    )
    .join("");
  return `<div class="sched-table-scroll">
    <table class="sched-table sched-changes-table">
      <thead><tr><th>#</th><th>Date</th><th>Slot</th><th>Shift</th><th>From</th><th>To</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function soldierDetailHtml(
  soldierIdx: number,
  title: string,
  rows: ReturnType<typeof buildSoldierBlockRows>,
  display: SoldierDisplay
): string {
  const trs = rows
    .map((r) => {
      const rowCls = r.free
        ? " class=\"sched-row-free\""
        : r.rest
          ? " class=\"sched-row-rest\""
          : "";
      const locCls = r.free
        ? " class=\"sched-free-cell\""
        : r.rest
          ? " class=\"sched-rest-cell\""
          : "";
      return `<tr${rowCls}>
          <td>${r.day}</td>
          <td>${r.block}</td>
          <td>${esc(r.window)}</td>
          <td>${esc(r.timeCategory)}</td>
          <td${locCls}>${esc(r.location)}</td>
          <td>${esc(r.slot)}</td>
          <td>${esc(r.hours)}</td>
          <td>${esc(r.weight)}</td>
        </tr>`;
    })
    .join("");
  const badge = soldierBadgeHtml(soldierIdx, title, display, "sched-soldier-title-badge");
  return `<div class="pdf-page sched-soldier-page">
    <h3 class="sched-subtitle">${badge}</h3>
    <div class="sched-table-scroll">
      <table class="sched-table sched-soldier-table">
        <thead><tr>
          <th>Day</th><th>Block #</th><th>Local window</th><th>Time category</th>
          <th>Location</th><th>Slot</th><th>Hours</th><th>Weight</th>
        </tr></thead>
        <tbody>${trs}</tbody>
      </table>
    </div>
  </div>`;
}

function planReportTimelineSegClass(seg: ReturnType<typeof buildTimelineLanes>[0]["segments"][0]): string {
  switch (timelineSegmentKind(seg)) {
    case "full_day_duty":
      return "seg seg-full-day";
    case "duty":
      return "seg seg-on";
    case "unavailable":
      return "seg seg-unavail";
    default:
      return "seg seg-off";
  }
}

function timelineHtml(
  lanes: ReturnType<typeof buildTimelineLanes>,
  days: number,
  planDayStartHour: number,
  display: SoldierDisplay,
  totalSpanHours: number,
): string {
  const layout = timelineChartLayout(days, planDayStartHour, totalSpanHours);
  const laneRows = lanes
    .map((lane) => {
      const segs = lane.segments
        .map(
          (seg) =>
            `<span class="${planReportTimelineSegClass(seg)}" style="left:${layout.segmentLeftPct(seg.startHour)}%;width:${layout.segmentWidthPct(seg.duration)}%"></span>`,
        )
        .join("");
      const badge = soldierBadgeHtml(lane.soldierIdx, lane.label, display);
      return `<div class="sched-timeline-bar">
        <span class="sched-timeline-label">${badge}</span>
        ${segs}
      </div>`;
    })
    .join("");
  return `<div class="sched-timeline-wrap">
    <p class="sched-hint">Green = off post, yellow = away/sick, red = rotating/windowed duty + rest, orange = full day / team duty + rest (matches soldier tables). ${days} plan day(s) from ${esc(formatWallClockHour(planDayStartHour))}; wall-clock UTC.</p>
    ${laneRows}
  </div>`;
}

function statsTableWrap(title: string, tableInner: string): string {
  return `<div class="pdf-page sched-stats-block">
    <h3 class="sched-subtitle">${esc(title)}</h3>
    <div class="sched-table-scroll">${tableInner}</div>
  </div>`;
}

function statsHtml(
  stats: ReturnType<typeof buildScheduleStats>,
  days: number,
  shiftHours: number,
  slotsPerBlock: number,
  display: SoldierDisplay
): string {
  const runTitle = `${days}d — ${stats.soldierCount} soldiers, ${slotsPerBlock} slots/block, shift_hours=${shiftHours}h`;

  const summaryRows = stats.summary
    .map((row) => {
      const nameCell = soldierBadgeHtml(row.soldierIdx, display.fullLabel(row.soldierIdx), display);
      return `<tr>
          <th scope="row">${nameCell}</th>
          <td>${row.totalRawHours.toFixed(2)}</td>
          <td>${row.globalScore.toFixed(4)}</td>
          <td>${row.minMaxFree.toFixed(2)}</td>
          <td>${row.meanMaxFree.toFixed(2)}</td>
          <td>${row.maxMaxFree.toFixed(2)}</td>
        </tr>`;
    })
    .join("");

  const summaryTable = `<table class="sched-table sched-stats-table">
    <thead><tr>
      <th>Soldier</th><th>Total raw guard (h)</th><th>Global score</th>
      <th>Min max free (h)</th><th>Mean max free (h)</th><th>Max max free (h)</th>
    </tr></thead>
    <tbody>${summaryRows}</tbody>
  </table>`;

  const locColHead = stats.locLabels.map((l) => `<th>${esc(l)}</th>`).join("");
  const locTotalRows = stats.summary
    .map((row) => {
      const name = soldierBadgeHtml(row.soldierIdx, display.fullLabel(row.soldierIdx), display);
      return `<tr><th scope="row">${name}</th>${row.rawHoursByLoc.map((h) => `<td>${h.toFixed(2)}</td>`).join("")}</tr>`;
    })
    .join("");
  const locTotalTable = `<table class="sched-table sched-stats-table sched-stats-table--wide">
    <thead><tr><th>Soldier</th>${locColHead}</tr></thead>
    <tbody>${locTotalRows}</tbody>
  </table>`;

  const timeColHead = stats.timeLabels.map((l) => `<th>${esc(l)} (%)</th>`).join("");
  const timePctRows = stats.summary
    .map((row) => {
      const name = soldierBadgeHtml(row.soldierIdx, display.fullLabel(row.soldierIdx), display);
      return `<tr><th scope="row">${name}</th>${row.timeBandPct.map((p) => `<td>${p.toFixed(1)}%</td>`).join("")}</tr>`;
    })
    .join("");
  const timePctTable = `<table class="sched-table sched-stats-table sched-stats-table--wide">
    <thead><tr><th>Soldier</th>${timeColHead}</tr></thead>
    <tbody>${timePctRows}</tbody>
  </table>`;

  let maxFreeBlock = "";
  if (days > 1) {
    const head = stats.summary.map((r) => `<th>${esc(r.label)}</th>`).join("");
    const body = stats.maxFree
      .map(
        (dayRow, d) =>
          `<tr><th scope="row">Day ${d + 1}</th>${dayRow.map((h) => `<td>${h.toFixed(2)}</td>`).join("")}</tr>`
      )
      .join("");
    maxFreeBlock = statsTableWrap(
      "Max consecutive free time (hours) — by day and soldier",
      `<table class="sched-table sched-stats-table sched-stats-table--wide">
        <thead><tr><th>Day</th>${head}</tr></thead><tbody>${body}</tbody></table>`
    );
  }

  const locMeanRows = stats.meanDailyRawLoc
    .map((row, s) => {
      const name = soldierBadgeHtml(s, display.fullLabel(s), display);
      return `<tr><th scope="row">${name}</th>${row.map((h) => `<td>${h.toFixed(2)}</td>`).join("")}</tr>`;
    })
    .join("");
  const locMeanTable = `<table class="sched-table sched-stats-table sched-stats-table--wide">
    <thead><tr><th>Soldier</th>${locColHead}</tr></thead>
    <tbody>${locMeanRows}</tbody>
  </table>`;

  const timeMeanRows = stats.meanDailyRawTime
    .map((row, s) => {
      const name = soldierBadgeHtml(s, display.fullLabel(s), display);
      return `<tr><th scope="row">${name}</th>${row.map((h) => `<td>${h.toFixed(2)}</td>`).join("")}</tr>`;
    })
    .join("");
  const timeMeanTable = `<table class="sched-table sched-stats-table sched-stats-table--wide">
    <thead><tr><th>Soldier</th>${stats.timeLabels.map((l) => `<th>${esc(l)} (h/day)</th>`).join("")}</tr></thead>
    <tbody>${timeMeanRows}</tbody>
  </table>`;

  const fairnessBlock = `<div class="pdf-page sched-stats-block sched-stats-fairness">
    <h2 class="sched-section-title">Statistics — ${esc(runTitle)}</h2>
    <h3 class="sched-subtitle">Global fairness</h3>
    <ul class="sched-global-list">
      <li><span class="sched-global-k">Fairness score</span><strong>${stats.fairness.fairnessScore.toFixed(4)}</strong> (lower is fairer)</li>
      <li><span class="sched-global-k">Std all Z</span>${stats.fairness.stdAllZ.toFixed(4)}</li>
      <li><span class="sched-global-k">Min std across slots</span>${stats.fairness.minStdSlotZ.toFixed(4)}</li>
      <li><span class="sched-global-k">Std raw hours</span>${stats.fairness.stdRawHours.toFixed(4)}</li>
      <li><span class="sched-global-k">Raw hours spread</span>${stats.fairness.rawHoursSpread.toFixed(2)} h</li>
    </ul>
  </div>`;

  return `${fairnessBlock}
    ${statsTableWrap("Soldier summary", summaryTable)}
    ${statsTableWrap("Total raw guard hours by location", locTotalTable)}
    ${statsTableWrap("Share of guard hours by time band (%)", timePctTable)}
    ${maxFreeBlock}
    ${statsTableWrap("Mean raw guard hours per calendar day by location", locMeanTable)}
    ${statsTableWrap("Mean raw guard hours per calendar day by time band", timeMeanTable)}`;
}

function availabilityReportHtml(
  proposal: PlanDoc,
  soldiers: Soldier[],
  display: SoldierDisplay,
): string {
  if (!proposal.soldiers || Object.keys(proposal.soldiers).length === 0) {
    return "";
  }
  const labelForId = (id: string) => {
    const ids = soldiers.map((s) => s.id);
    const idx = ids.indexOf(id);
    return idx >= 0 ? display.fullLabel(idx) : id;
  };
  const days = buildPlanAvailabilityReport(proposal, soldiers, labelForId);
  const dayBlocks = days
    .map((day) => {
      const rows = day.rows
        .map(
          (row) => `<tr class="sched-avail-row sched-avail-row--${esc(row.classification)}">
          <th scope="row">${esc(row.label)}</th>
          <td>${esc(classificationLabel(row.classification))}</td>
          <td>${esc(formatAvailabilityWindows(row.windows))}</td>
        </tr>`
        )
        .join("");
      return `<div class="sched-availability-day">
        <h3 class="sched-subtitle">${esc(day.date)}</h3>
        <div class="availability-badges-row">
          <span class="availability-badge availability-badge--full" title="Full">${day.summary.full}</span>
          <span class="availability-badge availability-badge--absent" title="Absent full">${day.summary.absent_full}</span>
          <span class="availability-badge availability-badge--partial" title="Partial">${day.summary.absent_partial}</span>
        </div>
        <div class="sched-table-scroll">
          <table class="sched-table sched-availability-table">
            <thead><tr><th>Soldier</th><th>Classification</th><th>Assignable windows</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
    })
    .join("");
  return `<div class="pdf-page sched-availability-report">
    <h2 class="sched-section-title">Soldier availability</h2>
    <p class="sched-hint">Snapshot embedded at generate/apply (read-only).</p>
    ${dayBlocks}
  </div>`;
}

/** Build a self-contained HTML document for the selected plan proposal (print / PDF). */
export function buildPlanReportHtml(input: PlanReportInput): string {
  const { proposal, slot, zones, soldierIds, soldiers, effectiveToday } = input;
  const assignments = proposal.assignments;
  const days = proposal.days;
  const shiftHours = proposal.shift_hours;
  const planDayStartHour = resolvePlanDayStartHour(proposal.meta);
  const anchorDate = proposal.anchor_date;
  const slotsPerBlock = countEnabledSlots(zones);
  const zone = buildZoneReportView(zones, slotsPerBlock);
  if (shiftHours > 0) {
    zone.shiftHours = shiftHours;
    zone.blocksPerDay = Math.round(24 / shiftHours);
  }
  const soldierCount = inferSoldierCount(assignments);
  const display = buildSoldierDisplay(soldierIds, soldiers, soldierCount);
  const matrices = buildScheduleMatrices(assignments, days, zone, {
    planDayStartHour,
    anchorDate,
    soldierIds,
  });
  const busy = buildBusyTensor(assignments, days, soldierCount, zone.blocksPerDay, true);
  const lanes = buildTimelineLanes(busy, zone.shiftHours, soldierCount, planDayStartHour, {
    soldierIds,
    anchorDate,
    shiftHours: zone.shiftHours,
    soldiersByDay: proposal.soldiers,
    assignments,
  });
  const stats = buildScheduleStats(assignments, days, zone, soldierCount);
  const totalHours = days * 24 + reportFutureExtensionBlocks(zone.shiftHours) * zone.shiftHours;
  const changes = proposal.changes ?? [];
  const generatedAt = new Date().toISOString().slice(0, 19).replace("T", " ");

  const matrixShort = matrices
    .map((m) =>
      matrixTableHtml(
        m,
        display.shortLabel,
        display,
        `${m.title} — schedule matrix (time × slot)`
      )
    )
    .join("");

  const matrixFull = matrices
    .map((m) =>
      matrixTableHtml(
        m,
        display.fullLabel,
        display,
        `${m.title} — schedule matrix (full name)`,
        true
      )
    )
    .join("");

  const soldierSections = Array.from({ length: soldierCount }, (_, s) => {
    const rows = buildSoldierBlockRows(s, assignments, days, zone, planDayStartHour);
    return soldierDetailHtml(s, display.fullLabel(s), rows, display);
  }).join("");

  const trialSeed =
    proposal.meta?.trial != null &&
    typeof proposal.meta.trial === "object" &&
    proposal.meta.trial !== null
      ? (proposal.meta.trial as Record<string, unknown>).trial_seed
      : undefined;

  const body = `
    <div class="pdf-cover">
      <h1>Guard plan — proposal ${esc(slot)}</h1>
      <p class="meta">
        Anchor: <strong>${esc(proposal.anchor_date)}</strong> ·
        Days: <strong>${days}</strong> ·
        Shift: <strong>${shiftHours}h</strong> ·
        Assignments: <strong>${assignments.length}</strong>
        ${effectiveToday ? ` · Effective today: <strong>${esc(effectiveToday)}</strong>` : ""}
        ${trialSeed != null ? ` · Seed: <strong>${esc(String(trialSeed))}</strong>` : ""}
        · Generated: ${esc(generatedAt)} UTC
        · Plan day starts: <strong>${esc(String(proposal.meta?.plan_day_start ?? "05:00"))}</strong>
      </p>
      <h2 class="sched-section-title">Manual swaps</h2>
      ${changesTableHtml(changes)}
    </div>

    ${matrixShort || ""}
    ${matrixFull || ""}
    ${soldierSections || ""}

    ${availabilityReportHtml(proposal, soldiers, display)}

    <div class="pdf-page">
      <h2 class="sched-section-title">Soldier timelines</h2>
      ${timelineHtml(lanes, days, planDayStartHour, display, totalHours)}
    </div>

    ${statsHtml(stats, days, zone.shiftHours, zone.slotsPerBlock, display)}
  `;

  return `<!DOCTYPE html>
<html lang="en" dir="auto">
<head>
  <meta charset="utf-8" />
  <title>Guard plan ${esc(proposal.anchor_date)} proposal ${esc(slot)}</title>
  <style>${REPORT_CSS}</style>
</head>
<body class="sched-report">${body}</body>
</html>`;
}

export function planReportPdfFilename(anchor: string, slot: string): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return `guard-plan-${safe(anchor)}-proposal-${safe(slot)}.pdf`;
}

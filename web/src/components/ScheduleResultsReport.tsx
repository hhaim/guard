import { useMemo, useState } from "react";
import { countEnabledSlots, type ZonesDoc } from "../lib/zones";
import type { PlatoonColorEntry } from "../lib/platoonColors";
import { buildSoldierDisplay, type SoldierDisplay } from "../lib/soldierDisplay";
import { docFromServer, type Soldier } from "../lib/soldiers";
import {
  buildBusyTensor,
  buildScheduleMatrices,
  buildSoldierBlockRows,
  buildScheduleStats,
  buildTimelineLanes,
  buildZoneReportView,
  formatTimelineSegmentRange,
  inferSoldierCount,
  MATRIX_CELL_MAX_SOLDIERS,
  formatMatrixCellLabels,
  reportFutureExtensionBlocks,
  timelineSegmentClassName,
  timelineSegmentTitle,
} from "../lib/scheduleReport";
import { normalizePlanDoc, type PlanDoc } from "../lib/planDoc";
import { formatWallClockHour, resolvePlanDayStartHour, timelineChartLayout } from "../lib/planDay";
import { ScheduleStatsPanel } from "./ScheduleStatsPanel";
import { PlanSoldierAvailabilitySection } from "./PlanSoldierAvailabilitySection";

export type ScheduleReportSections = {
  matrixShort?: boolean;
  matrixFull?: boolean;
  bySoldier?: boolean;
  timeline?: boolean;
  statsPanel?: boolean;
  availability?: boolean;
};

const DEFAULT_SECTIONS: Required<ScheduleReportSections> = {
  matrixShort: true,
  matrixFull: true,
  bySoldier: true,
  timeline: true,
  statsPanel: true,
  availability: true,
};

type Props = {
  plan: PlanDoc;
  zones: ZonesDoc;
  soldierIds?: string[];
  soldiers?: Soldier[];
  platoonColors?: PlatoonColorEntry[];
  sections?: ScheduleReportSections;
};

function SoldierLink({
  soldierIdx,
  label,
  selected,
  onSelect,
  display,
  title,
  matrixCell = false,
}: {
  soldierIdx: number;
  label: string;
  selected: boolean;
  onSelect: (idx: number) => void;
  display: SoldierDisplay;
  title?: string;
  matrixCell?: boolean;
}) {
  const style = matrixCell ? display.matrixBadgeStyle(soldierIdx) : display.badgeStyle(soldierIdx);
  return (
    <button
      type="button"
      className={`sched-soldier-link sched-soldier-badge${selected ? " is-selected" : ""}`}
      style={style}
      onClick={() => onSelect(soldierIdx)}
      title={title}
    >
      {label}
    </button>
  );
}

function MatrixCellContent({
  cell,
  labelForIdx,
  selectedSoldier,
  onSelectSoldier,
  display,
  useFullNames,
  matrixCell = false,
}: {
  cell: import("../lib/scheduleReport").MatrixCell;
  labelForIdx: (idx: number) => string;
  selectedSoldier: number | null;
  onSelectSoldier: (idx: number) => void;
  display: SoldierDisplay;
  useFullNames?: boolean;
  matrixCell?: boolean;
}) {
  if (cell.disabled) {
    return <span className="sched-matrix-disabled">—</span>;
  }
  const indices =
    cell.soldierIndices ?? (cell.soldierIdx != null && cell.soldierIdx >= 0 ? [cell.soldierIdx] : []);
  if (indices.length === 0) {
    return <>{cell.label}</>;
  }
  const labels = useFullNames
    ? indices.map((idx) => display.fullLabel(idx))
    : (cell.labels ?? indices.map((idx) => labelForIdx(idx)));
  if (indices.length > 1) {
    const show = indices.slice(0, MATRIX_CELL_MAX_SOLDIERS);
    const showLabels = labels.slice(0, MATRIX_CELL_MAX_SOLDIERS);
    const extra = indices.length - show.length;
    return (
      <div className="sched-matrix-cell-team" title={formatMatrixCellLabels(indices, labels)}>
        {show.map((idx, i) => (
          <SoldierLink
            key={idx}
            soldierIdx={idx}
            label={showLabels[i] ?? labelForIdx(idx)}
            title={useFullNames ? undefined : display.fullLabel(idx)}
            selected={selectedSoldier === idx}
            onSelect={onSelectSoldier}
            display={display}
            matrixCell={matrixCell}
          />
        ))}
        {extra > 0 ? <span className="sched-matrix-cell-more"> (+{extra} more)</span> : null}
      </div>
    );
  }
  const idx = indices[0];
  return (
    <SoldierLink
      soldierIdx={idx}
      label={labels[0] ?? labelForIdx(idx)}
      selected={selectedSoldier === idx}
      onSelect={onSelectSoldier}
      display={display}
      matrixCell={matrixCell}
    />
  );
}

function matrixCellSoldierIndices(cell: import("../lib/scheduleReport").MatrixCell): number[] {
  return cell.soldierIndices ?? (cell.soldierIdx != null && cell.soldierIdx >= 0 ? [cell.soldierIdx] : []);
}

function matrixCellBackgroundStyle(
  cell: import("../lib/scheduleReport").MatrixCell,
  display: SoldierDisplay
): { backgroundColor: string } | undefined {
  const indices = matrixCellSoldierIndices(cell);
  if (indices.length === 0) return undefined;
  return display.matrixCellStyle(indices[0]);
}

function ScheduleMatrixTable({
  matrix,
  selectedSoldier,
  onSelectSoldier,
  display,
  labelForIdx,
  useFullNames,
}: {
  matrix: ReturnType<typeof buildScheduleMatrices>[number];
  selectedSoldier: number | null;
  onSelectSoldier: (idx: number) => void;
  display: SoldierDisplay;
  labelForIdx: (idx: number) => string;
  useFullNames?: boolean;
}) {
  return (
    <div className="sched-matrix-block">
      <h4 className="sched-subtitle">{matrix.title} — schedule matrix (time × slot)</h4>
      <div className="sched-table-scroll">
        <table className="sched-table sched-matrix-table">
          <thead>
            <tr>
              <th>Time shift</th>
              {matrix.headers.map((h) => (
                <th key={h.slot}>
                  Slot {h.slot}
                  <span className="sched-th-sub">
                    {h.label} ({h.locId})
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row) => (
              <tr key={row.window}>
                <th scope="row">{row.window}</th>
                {row.cells.map((cell, j) => {
                  if (cell.skip) return null;
                  const teamClass =
                    (cell.soldierIndices?.length ?? 0) > 1 ? " sched-matrix-td-team" : "";
                  const inner = (
                    <MatrixCellContent
                      cell={cell}
                      labelForIdx={labelForIdx}
                      selectedSoldier={selectedSoldier}
                      onSelectSoldier={onSelectSoldier}
                      display={display}
                      useFullNames={useFullNames}
                      matrixCell
                    />
                  );
                  const cellBg = matrixCellBackgroundStyle(cell, display);
                  if (cell.rowspan && cell.rowspan > 1) {
                    return (
                      <td
                        key={`${row.window}-${j}`}
                        rowSpan={cell.rowspan}
                        className={teamClass.trim()}
                        style={cellBg}
                      >
                        {inner}
                      </td>
                    );
                  }
                  return (
                    <td key={`${row.window}-${j}`} className={teamClass.trim()} style={cellBg}>
                      {inner}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SoldierDetailTable({
  soldierIdx,
  rows,
  display,
}: {
  soldierIdx: number;
  rows: ReturnType<typeof buildSoldierBlockRows>;
  display: SoldierDisplay;
}) {
  const title = display.fullLabel(soldierIdx);
  return (
    <div className="sched-soldier-detail" id={`soldier-${soldierIdx}`}>
      <h4 className="sched-subtitle">
        <span
          className="sched-soldier-badge sched-soldier-title-badge"
          style={display.badgeStyle(soldierIdx)}
        >
          {title}
        </span>
      </h4>
      <div className="sched-table-scroll">
        <table className="sched-table">
          <thead>
            <tr>
              <th>Day</th>
              <th>Block #</th>
              <th>Local window</th>
              <th>Time category</th>
              <th>Location</th>
              <th>Slot</th>
              <th>Hours</th>
              <th>Weight</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={`${r.day}-${r.block}`}
                className={
                  r.free ? "sched-row-free" : r.rest ? "sched-row-rest" : undefined
                }
              >
                <td>{r.day}</td>
                <td>{r.block}</td>
                <td>{r.window}</td>
                <td>{r.timeCategory}</td>
                <td
                  className={
                    r.free ? "sched-free-cell" : r.rest ? "sched-rest-cell" : undefined
                  }
                >
                  {r.location}
                </td>
                <td>{r.slot}</td>
                <td>{r.hours}</td>
                <td>{r.weight}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SoldierTimelineChart({
  lanes,
  days,
  blockHours,
  slotsPerBlock,
  planDayStartHour,
  totalHours,
  display,
}: {
  lanes: ReturnType<typeof buildTimelineLanes>;
  days: number;
  blockHours: number;
  slotsPerBlock: number;
  planDayStartHour: number;
  totalHours: number;
  display: SoldierDisplay;
}) {
  const layout = useMemo(
    () => timelineChartLayout(days, planDayStartHour, totalHours),
    [days, planDayStartHour, totalHours],
  );

  const ticks = useMemo(() => {
    const out: { label: string; left: number }[] = [];
    const step = layout.spanHours <= 24 ? 4 : 6;
    for (let off = 0; off <= layout.spanHours; off += step) {
      out.push({ label: layout.tickWallClock(off), left: layout.tickLeftPct(off) });
    }
    return out;
  }, [layout]);

  return (
    <div className="sched-timeline-wrap">
      <h4 className="sched-subtitle">Soldier timelines (full simulation)</h4>
      <p className="sched-hint">
        Green = off post and assignable, yellow = away/sick/training, red = rotating/windowed duty
        + rest, orange = full day / team duty + rest (matches soldier tables). X-axis is wall-clock
        time from plan day start ({formatWallClockHour(planDayStartHour)}); dashed lines mark the
        next plan day.
      </p>
      <p className="sched-hint sched-timeline-caption">
        {days}d — {lanes.length} soldiers, {slotsPerBlock} slots/block, shift_hours={blockHours}h
      </p>
      <div className="sched-timeline-chart">
        <div className="sched-timeline-legend" aria-hidden>
          <span>
            <i className="sched-swatch sched-swatch-off" /> Off post
          </span>
          <span>
            <i className="sched-swatch sched-swatch-unavail" /> Away / sick
          </span>
          <span>
            <i className="sched-swatch sched-swatch-on" /> Rotating / windowed
          </span>
          <span>
            <i className="sched-swatch sched-swatch-full-day" /> Full day / team
          </span>
        </div>
        <div className="sched-timeline-axis">
          {ticks.map((t) => (
            <span key={t.label} className="sched-timeline-tick" style={{ left: `${t.left}%` }}>
              {t.label}
            </span>
          ))}
        </div>
        <div className="sched-timeline-grid">
          {days > 1 &&
            Array.from({ length: days - 1 }, (_, i) => (
              <div
                key={i}
                className="sched-timeline-midnight"
                style={{ left: `${layout.dayBoundaryLeftPct(i)}%` }}
              />
            ))}
          {lanes.map((lane) => (
            <div key={lane.soldierIdx} className="sched-timeline-lane">
              <span
                className="sched-timeline-label sched-soldier-badge"
                style={display.badgeStyle(lane.soldierIdx)}
              >
                {lane.label}
              </span>
              <div className="sched-timeline-bar">
                {lane.segments.map((seg, i) => (
                  <span
                    key={i}
                    className={timelineSegmentClassName(seg)}
                    style={{
                      left: `${layout.segmentLeftPct(seg.startHour)}%`,
                      width: `${layout.segmentWidthPct(seg.duration)}%`,
                    }}
                    title={`${lane.label}: ${timelineSegmentTitle(seg)} ${formatTimelineSegmentRange(seg, planDayStartHour)}`}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="sched-timeline-xlabel">Wall-clock time (UTC)</div>
      </div>
    </div>
  );
}

/** Schedule matrix, per-soldier drill-down, and timeline (Python HTML report parity). */
export function ScheduleResultsReport({
  plan: planProp,
  zones,
  soldierIds = [],
  soldiers = [],
  platoonColors = [],
  sections: sectionsProp,
}: Props) {
  const plan = useMemo(() => normalizePlanDoc(planProp), [planProp]);
  const { assignments, days, shift_hours: shiftHours, meta, anchor_date: anchorDate } = plan;
  const planDayStartHour = resolvePlanDayStartHour(meta);
  const verifiedDates = useMemo(() => {
    const raw = meta?.verified_dates;
    if (Array.isArray(raw)) {
      return raw.filter((d): d is string => typeof d === "string" && d.length >= 10);
    }
    return undefined;
  }, [meta]);

  const sections = { ...DEFAULT_SECTIONS, ...sectionsProp };
  const [selectedSoldier, setSelectedSoldier] = useState<number | null>(null);
  const [showJson, setShowJson] = useState(false);

  const zoneBundle = useMemo(() => {
    const slotsPerBlock = countEnabledSlots(zones);
    const zone = buildZoneReportView(zones, slotsPerBlock);
    if (shiftHours > 0) {
      zone.shiftHours = shiftHours;
      zone.blocksPerDay = Math.round(24 / shiftHours);
    }
    const soldierCount = inferSoldierCount(assignments);
    return { zone, soldierCount };
  }, [assignments, shiftHours, zones]);

  const report = useMemo(() => {
    const { zone, soldierCount } = zoneBundle;
    const needMatrix = sections.matrixShort || sections.matrixFull;
    const needTimeline = sections.timeline;
    const needStats = sections.statsPanel;

    const matrices = needMatrix
      ? buildScheduleMatrices(assignments, days, zone, {
          planDayStartHour,
          anchorDate,
          verifiedDates,
          soldierIds,
        })
      : [];
    const busy = needTimeline
      ? buildBusyTensor(assignments, days, soldierCount, zone.blocksPerDay, true)
      : null;
    const lanes =
      needTimeline && busy
        ? buildTimelineLanes(busy, zone.shiftHours, soldierCount, planDayStartHour, {
            soldierIds,
            anchorDate,
            verifiedDates,
            shiftHours: zone.shiftHours,
            soldiersByDay: plan.soldiers,
            assignments,
          })
        : [];
    const stats = needStats ? buildScheduleStats(assignments, days, zone, soldierCount) : null;
    return {
      zone,
      soldierCount,
      matrices,
      busy,
      lanes,
      totalHours: days * 24 + reportFutureExtensionBlocks(zone.shiftHours) * zone.shiftHours,
      stats,
    };
  }, [
    zoneBundle,
    assignments,
    days,
    planDayStartHour,
    anchorDate,
    verifiedDates,
    soldierIds,
    plan.soldiers,
    sections.matrixShort,
    sections.matrixFull,
    sections.timeline,
    sections.statsPanel,
  ]);

  const display = useMemo(
    () => buildSoldierDisplay(soldierIds, soldiers, report.soldierCount, platoonColors),
    [soldierIds, soldiers, report.soldierCount, platoonColors]
  );

  const soldierRows = useMemo(() => {
    if (selectedSoldier == null) return null;
    return buildSoldierBlockRows(
      selectedSoldier,
      assignments,
      days,
      report.zone,
      planDayStartHour,
    );
  }, [selectedSoldier, assignments, days, report.zone, planDayStartHour]);

  const trialSeed =
    meta?.trial != null && typeof meta.trial === "object" && meta.trial !== null
      ? (meta.trial as Record<string, unknown>).trial_seed
      : undefined;

  const selectSoldier = (idx: number) => {
    setSelectedSoldier(idx);
    requestAnimationFrame(() => {
      document.getElementById(`soldier-${idx}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  };

  const showMatrix =
    (sections.matrixShort || sections.matrixFull) && report.matrices.length > 0;

  return (
    <div className="sched-report">
      <div className="sched-report-toolbar">
        <p className="sched-hint">
          {assignments.length} assignments · {report.zone.blocksPerDay} blocks/day · {report.zone.shiftHours}h shifts
          {trialSeed != null ? ` · seed ${String(trialSeed)}` : ""}
          {` · plan day starts ${String(meta?.plan_day_start ?? "05:00")}`}
        </p>
        <button type="button" className="btn btn-tinted sched-json-toggle" onClick={() => setShowJson((v) => !v)}>
          {showJson ? "Hide JSON" : "Show JSON"}
        </button>
      </div>

      {showJson && (
        <pre className="raw-response run-results-json">{JSON.stringify(plan, null, 2)}</pre>
      )}

      {showMatrix && sections.matrixShort && (
        <section className="sched-section">
          <h3 className="sched-section-title">Schedule by day</h3>
          {report.matrices.map((m) => (
            <ScheduleMatrixTable
              key={`short-${m.day}`}
              matrix={m}
              selectedSoldier={selectedSoldier}
              onSelectSoldier={selectSoldier}
              display={display}
              labelForIdx={display.shortLabel}
            />
          ))}
        </section>
      )}

      {showMatrix && sections.matrixFull && (
        <section className="sched-section">
          <h3 className="sched-section-title">Schedule by day (full name)</h3>
          {report.matrices.map((m) => (
            <ScheduleMatrixTable
              key={`full-${m.day}`}
              matrix={m}
              selectedSoldier={selectedSoldier}
              onSelectSoldier={selectSoldier}
              display={display}
              labelForIdx={display.fullLabel}
              useFullNames
            />
          ))}
        </section>
      )}

      {sections.bySoldier && (
        <section className="sched-section">
          <h3 className="sched-section-title">Schedule by soldier</h3>
          <p className="sched-hint">Click a soldier in the matrix above, or pick one below.</p>
          <div className="sched-soldier-jump">
            {Array.from({ length: report.soldierCount }, (_, s) => (
              <SoldierLink
                key={s}
                soldierIdx={s}
                label={display.shortLabel(s)}
                selected={selectedSoldier === s}
                onSelect={selectSoldier}
                display={display}
              />
            ))}
          </div>
          {selectedSoldier != null && soldierRows ? (
            <SoldierDetailTable soldierIdx={selectedSoldier} rows={soldierRows} display={display} />
          ) : (
            <p className="contacts-empty">Select a soldier to see their block-by-block schedule.</p>
          )}
        </section>
      )}

      {sections.timeline && (
        <SoldierTimelineChart
          lanes={report.lanes}
          days={days}
          blockHours={report.zone.shiftHours}
          slotsPerBlock={report.zone.slotsPerBlock}
          planDayStartHour={planDayStartHour}
          totalHours={report.totalHours}
          display={display}
        />
      )}

      {sections.statsPanel && report.stats && (
        <ScheduleStatsPanel
          stats={report.stats}
          days={days}
          shiftHours={report.zone.shiftHours}
          slotsPerBlock={report.zone.slotsPerBlock}
        />
      )}

      {sections.availability && (
        <PlanSoldierAvailabilitySection plan={plan} soldiers={soldiers} />
      )}
    </div>
  );
}

/** Resolve soldiers from API cfg payload. */
export function soldiersFromCfg(value: unknown): Soldier[] {
  return docFromServer(value).soldiers;
}

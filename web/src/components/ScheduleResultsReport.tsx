import { useMemo, useState } from "react";
import type { ZonesDoc } from "../lib/zones";
import { buildSoldierDisplay, type SoldierDisplay } from "../lib/soldierDisplay";
import { docFromServer, type Soldier } from "../lib/soldiers";
import {
  buildDutyBusy,
  buildScheduleMatrices,
  buildSoldierBlockRows,
  buildScheduleStats,
  buildTimelineLanes,
  buildZoneReportView,
  formatTimelineSegmentRange,
  inferSoldierCount,
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
  sections?: ScheduleReportSections;
};

function SoldierLink({
  soldierIdx,
  label,
  selected,
  onSelect,
  display,
}: {
  soldierIdx: number;
  label: string;
  selected: boolean;
  onSelect: (idx: number) => void;
  display: SoldierDisplay;
}) {
  return (
    <button
      type="button"
      className={`sched-soldier-link sched-soldier-badge${selected ? " is-selected" : ""}`}
      style={display.badgeStyle(soldierIdx)}
      onClick={() => onSelect(soldierIdx)}
    >
      {label}
    </button>
  );
}

function ScheduleMatrixTable({
  matrix,
  selectedSoldier,
  onSelectSoldier,
  display,
  labelForIdx,
}: {
  matrix: ReturnType<typeof buildScheduleMatrices>[number];
  selectedSoldier: number | null;
  onSelectSoldier: (idx: number) => void;
  display: SoldierDisplay;
  labelForIdx: (idx: number) => string;
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
                  const cellLabel =
                    cell.soldierIdx != null ? labelForIdx(cell.soldierIdx) : cell.label;
                  if (cell.rowspan && cell.rowspan > 1) {
                    return (
                      <td key={`${row.window}-${j}`} rowSpan={cell.rowspan}>
                        {cell.soldierIdx != null ? (
                          <SoldierLink
                            soldierIdx={cell.soldierIdx}
                            label={cellLabel}
                            selected={selectedSoldier === cell.soldierIdx}
                            onSelect={onSelectSoldier}
                            display={display}
                          />
                        ) : (
                          cellLabel
                        )}
                      </td>
                    );
                  }
                  return (
                    <td key={`${row.window}-${j}`}>
                      {cell.soldierIdx != null ? (
                        <SoldierLink
                          soldierIdx={cell.soldierIdx}
                          label={cellLabel}
                          selected={selectedSoldier === cell.soldierIdx}
                          onSelect={onSelectSoldier}
                          display={display}
                        />
                      ) : (
                        cellLabel
                      )}
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
              <tr key={`${r.day}-${r.block}`} className={r.free ? "sched-row-free" : undefined}>
                <td>{r.day}</td>
                <td>{r.block}</td>
                <td>{r.window}</td>
                <td>{r.timeCategory}</td>
                <td className={r.free ? "sched-free-cell" : undefined}>{r.location}</td>
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
  display,
}: {
  lanes: ReturnType<typeof buildTimelineLanes>;
  days: number;
  blockHours: number;
  slotsPerBlock: number;
  planDayStartHour: number;
  display: SoldierDisplay;
}) {
  const layout = useMemo(
    () => timelineChartLayout(days, planDayStartHour),
    [days, planDayStartHour],
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
        Green = off post and assignable, yellow = away/sick/training, red = posted duty. X-axis
        is wall-clock time from plan day start ({formatWallClockHour(planDayStartHour)}); dashed
        lines mark the next plan day.
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
            <i className="sched-swatch sched-swatch-on" /> Posted duty
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
                    className={
                      seg.onDuty
                        ? "sched-seg sched-seg-on"
                        : seg.unavailable
                          ? "sched-seg sched-seg-unavail"
                          : "sched-seg sched-seg-off"
                    }
                    style={{
                      left: `${layout.segmentLeftPct(seg.startHour)}%`,
                      width: `${layout.segmentWidthPct(seg.duration)}%`,
                    }}
                    title={`${lane.label}: ${
                      seg.onDuty ? "duty" : seg.unavailable ? "away/sick" : "off post"
                    } ${formatTimelineSegmentRange(seg, planDayStartHour)}`}
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
  sections: sectionsProp,
}: Props) {
  const plan = useMemo(() => normalizePlanDoc(planProp), [planProp]);
  const { assignments, days, shift_hours: shiftHours, meta, anchor_date: anchorDate } = plan;
  const planDayStartHour = resolvePlanDayStartHour(meta);

  const sections = { ...DEFAULT_SECTIONS, ...sectionsProp };
  const [selectedSoldier, setSelectedSoldier] = useState<number | null>(null);
  const [showJson, setShowJson] = useState(false);

  const report = useMemo(() => {
    const slotsPerBlock = zones.slots.length;
    const zone = buildZoneReportView(zones, slotsPerBlock);
    if (shiftHours > 0) {
      zone.shiftHours = shiftHours;
      zone.blocksPerDay = Math.round(24 / shiftHours);
    }
    const soldierCount = inferSoldierCount(assignments);
    const busy = buildDutyBusy(assignments, days, soldierCount, zone.blocksPerDay);
    return {
      zone,
      soldierCount,
      matrices: buildScheduleMatrices(assignments, days, zone, {
        planDayStartHour,
        anchorDate,
        soldierIds,
      }),
      busy,
      lanes: buildTimelineLanes(busy, zone.shiftHours, soldierCount, planDayStartHour, {
        soldierIds,
        anchorDate,
        shiftHours: zone.shiftHours,
        soldiersByDay: plan.soldiers,
      }),
      totalHours: days * 24,
      stats: buildScheduleStats(assignments, days, zone, soldierCount),
    };
  }, [assignments, days, shiftHours, zones, anchorDate, planDayStartHour, soldierIds, plan.soldiers]);

  const display = useMemo(
    () => buildSoldierDisplay(soldierIds, soldiers, report.soldierCount),
    [soldierIds, soldiers, report.soldierCount]
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
          display={display}
        />
      )}

      {sections.statsPanel && (
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

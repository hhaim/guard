import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { apiGet } from "../api";
import { fetchPlanContext } from "../api/plan";
import { formatPartialWindows } from "../lib/planDayBounds";
import { calendarDateForDay, parsePlanDayStart } from "../lib/planDay";
import { classifySoldierDay } from "../lib/soldierAvailability";
import { sortSoldiers, type Soldier } from "../lib/soldiers";
import { AddAbsenceSheet } from "./AddAbsenceSheet";
import { StatusCellSheet } from "./StatusCellSheet";

export type PlanDaySoldiersSummary = {
  full: number;
  absent_full: number;
  absent_partial: number;
};

export type PlanDaySoldiers = {
  avail_full?: string[];
  avail_partial?: Record<string, string[][]>;
  avail_absent?: string[];
  summary?: PlanDaySoldiersSummary;
};

type Props = {
  soldiers: Soldier[];
  planDayStart?: string;
};

function classify(soldierId: string, day: PlanDaySoldiers): "full" | "partial" | "absent" {
  return classifySoldierDay(soldierId, day);
}

function cellTitle(soldierId: string, day: PlanDaySoldiers, kind: string): string {
  if (kind === "partial") {
    const w = day.avail_partial?.[soldierId];
    return w ? `Assignable: ${formatPartialWindows(w)}` : "Partial";
  }
  return kind === "full" ? "Full plan day" : "Absent full plan day";
}

/** Full on every visible plan day in the board window. */
function isFullyAvailableAllDays(
  soldierId: string,
  dayColumns: { date: string }[],
  byDay?: Record<string, PlanDaySoldiers>,
): boolean {
  if (dayColumns.length === 0) return true;
  return dayColumns.every((c) => {
    const day = byDay?.[c.date];
    if (!day) return true;
    return classify(soldierId, day) === "full";
  });
}

function StatusBoardColGroup({ dayColumns }: { dayColumns: { date: string }[] }) {
  return (
    <colgroup>
      <col className="status-board-col-label" />
      {dayColumns.map((c) => (
        <col key={c.date} className="status-board-col-day" />
      ))}
    </colgroup>
  );
}

function StatusBoardTable({
  soldiers,
  dayColumns,
  startLabel,
  byDay,
  onCell,
}: {
  soldiers: Soldier[];
  dayColumns: { date: string }[];
  startLabel: string;
  byDay?: Record<string, PlanDaySoldiers>;
  onCell: (args: {
    soldierId: string;
    soldierName: string;
    date: string;
    kind: "full" | "partial" | "absent";
  }) => void;
}) {
  if (soldiers.length === 0) return null;
  return (
    <div className="status-board-scroll">
      <table className="contacts-table status-board-table">
        <StatusBoardColGroup dayColumns={dayColumns} />
        <thead>
          <tr>
            <th scope="col">Soldier</th>
            {dayColumns.map((c) => (
              <th key={c.date} scope="col" className="status-board-day-th">
                <span className="status-board-date">{c.date.slice(5)}</span>
                <span className="status-board-day-hint">{startLabel}→</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {soldiers.map((s) => (
            <tr key={s.id}>
              <td className="status-board-name">{s.full_name.trim() || s.id}</td>
              {dayColumns.map((c) => {
                const day = byDay?.[c.date];
                const kind = day ? classify(s.id, day) : "full";
                return (
                  <td key={c.date} className="status-board-cell">
                    <button
                      type="button"
                      className={`status-chip status-chip--${kind} status-board-chip`}
                      title={day ? cellTitle(s.id, day, kind) : "Tap to set status"}
                      onClick={() =>
                        onCell({
                          soldierId: s.id,
                          soldierName: s.full_name.trim() || s.id,
                          date: c.date,
                          kind,
                        })
                      }
                    >
                      {kind === "full" ? "Full" : kind === "partial" ? "Partial" : "Absent"}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SoldiersStatusBoard({ soldiers, planDayStart = "05:00" }: Props) {
  const qc = useQueryClient();
  const planCtxQ = useQuery({
    queryKey: ["plan", "context"],
    queryFn: () => fetchPlanContext(),
  });
  const anchor = planCtxQ.data?.plan_anchor ?? "";
  const startParsed = parsePlanDayStart(planCtxQ.data?.plan_day_start ?? planDayStart);
  const planDayStartHour = startParsed.ok ? startParsed.hour : 5;
  const startLabel = startParsed.ok ? startParsed.value : planDayStart;

  const sorted = useMemo(() => sortSoldiers(soldiers), [soldiers]);
  const dayColumns = useMemo(() => {
    if (!anchor) return [];
    return Array.from({ length: 7 }, (_, i) => ({
      offset: i,
      date: calendarDateForDay(anchor, i),
    }));
  }, [anchor]);

  const previewsQ = useQuery({
    queryKey: ["plan", "preview-availability", anchor, planDayStartHour],
    enabled: Boolean(anchor),
    queryFn: async () => {
      const out: Record<string, PlanDaySoldiers> = {};
      for (let i = 0; i < 7; i++) {
        const date = calendarDateForDay(anchor, i);
        out[date] = await apiGet<PlanDaySoldiers>(
          `/api/plan/preview-availability?date=${encodeURIComponent(date)}`,
        );
      }
      return out;
    },
  });

  const [fabOpen, setFabOpen] = useState(false);
  const [cellSheet, setCellSheet] = useState<{
    soldierId: string;
    soldierName: string;
    date: string;
    kind: "full" | "partial" | "absent";
  } | null>(null);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["plan", "preview-availability"] });
    void qc.invalidateQueries({ queryKey: ["soldiers", "status"] });
  };

  const { problematic, allFull } = useMemo(() => {
    const byDay = previewsQ.data;
    const prob: Soldier[] = [];
    const full: Soldier[] = [];
    for (const s of sorted) {
      if (isFullyAvailableAllDays(s.id, dayColumns, byDay)) {
        full.push(s);
      } else {
        prob.push(s);
      }
    }
    return { problematic: prob, allFull: full };
  }, [sorted, dayColumns, previewsQ.data]);

  return (
    <>
      <section className="glass-card contacts-list-card status-board" aria-label="Status board">
        <header className="status-board-header">
          <div>
            <h3 className="contacts-title">Status board</h3>
            <p className="contacts-count">
              Next 7 plan days from {anchor || "…"} · {startLabel} → {startLabel} next day
              {!previewsQ.isLoading && sorted.length > 0 ? (
                <>
                  {" "}
                  · {problematic.length} need attention
                  {allFull.length > 0 ? ` · ${allFull.length} fully available` : ""}
                </>
              ) : null}
            </p>
          </div>
          <button
            type="button"
            className="contacts-add-btn status-board-fab"
            aria-label="Add absence"
            title="Add absence"
            onPointerDown={(e) => {
              e.preventDefault();
              setFabOpen(true);
            }}
          >
            <Plus size={22} strokeWidth={2.5} />
          </button>
        </header>

        <AvailabilityBadges
          soldiersByDay={previewsQ.data}
          label="Availability (preview)"
          planDayStartLabel={startLabel}
        />

        {previewsQ.isLoading && <p className="contacts-empty">Loading availability…</p>}
        {!previewsQ.isLoading && sorted.length > 0 && (
          <>
            {problematic.length === 0 ? (
              <p className="contacts-empty status-board-all-clear">
                Everyone is fully available for the next 7 plan days.
              </p>
            ) : (
              <StatusBoardTable
                soldiers={problematic}
                dayColumns={dayColumns}
                startLabel={startLabel}
                byDay={previewsQ.data}
                onCell={(args) => setCellSheet(args)}
              />
            )}

            {allFull.length > 0 && (
              <details className="status-board-full-details">
                <summary>
                  {allFull.length} soldier{allFull.length === 1 ? "" : "s"} fully available (all 7 days)
                </summary>
                <StatusBoardTable
                  soldiers={allFull}
                  dayColumns={dayColumns}
                  startLabel={startLabel}
                  byDay={previewsQ.data}
                  onCell={(args) => setCellSheet(args)}
                />
              </details>
            )}
          </>
        )}
        <p className="contacts-hint status-board-foot">
          Tap a cell to set status — changes save immediately. Use <strong>On base</strong> in the cell sheet to clear
          away/sick/training for that plan day. Plan-day windows use {startLabel}, not midnight.
        </p>
      </section>

      <AddAbsenceSheet
        open={fabOpen}
        soldiers={sorted}
        anchorDate={anchor}
        planDayStartHour={planDayStartHour}
        onClose={() => setFabOpen(false)}
        onSaved={invalidate}
      />

      {cellSheet && (
        <StatusCellSheet
          open
          soldierId={cellSheet.soldierId}
          soldierName={cellSheet.soldierName}
          calendarDate={cellSheet.date}
          planDayStartHour={planDayStartHour}
          planDayStartLabel={startLabel}
          cellKind={cellSheet.kind}
          onClose={() => setCellSheet(null)}
          onSaved={invalidate}
        />
      )}
    </>
  );
}

function dayCounts(day: PlanDaySoldiers): { full: number; absent: number; partial: number } {
  return {
    full: day.summary?.full ?? day.avail_full?.length ?? 0,
    absent: day.summary?.absent_full ?? 0,
    partial:
      day.summary?.absent_partial ??
      (day.avail_partial ? Object.keys(day.avail_partial).length : 0),
  };
}

function slashVariant(absent: number, partial: number): "full" | "absent" | "partial" {
  if (partial > 0) return "partial";
  if (absent > 0) return "absent";
  return "full";
}

/** §7.3 — compact full/absent/partial counts per plan day (e.g. 16/0/0). */
export function AvailabilityBadges({
  soldiersByDay,
  label = "Availability",
  planDayStartLabel = "05:00",
}: {
  soldiersByDay?: Record<string, PlanDaySoldiers>;
  label?: string;
  planDayStartLabel?: string;
}) {
  if (!soldiersByDay || Object.keys(soldiersByDay).length === 0) return null;

  const dates = Object.keys(soldiersByDay).sort();

  return (
    <div className="availability-summary" role="group" aria-label={label}>
      <p className="availability-summary-title">{label}</p>
      <div className="status-board-scroll availability-summary-scroll">
        <table className="contacts-table status-board-table availability-summary-table">
          <StatusBoardColGroup dayColumns={dates.map((date) => ({ date }))} />
          <thead>
            <tr>
              <th scope="col" className="availability-summary-row-label">
                Counts
              </th>
              {dates.map((date) => (
                <th key={date} scope="col" className="status-board-day-th">
                  <span className="status-board-date">{date.slice(5)}</span>
                  <span className="status-board-day-hint">{planDayStartLabel}→</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" className="availability-summary-row-label">
                <span className="availability-summary-format" title="full / absent / partial">
                  #
                </span>
              </th>
              {dates.map((date) => {
                const { full, absent, partial } = dayCounts(soldiersByDay[date]);
                const variant = slashVariant(absent, partial);
                return (
                  <td key={date} className="status-board-cell">
                    <span
                      className={`status-chip status-chip--${variant} status-board-chip availability-slash`}
                      title={`${full} full · ${absent} absent full day · ${partial} partial`}
                    >
                      {full}/{absent}/{partial}
                    </span>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Fetch preview availability for N plan days from anchor (for Plan tab before generate). */
export async function fetchPreviewAvailabilityByDays(
  anchor: string,
  days: number,
): Promise<Record<string, PlanDaySoldiers>> {
  const out: Record<string, PlanDaySoldiers> = {};
  for (let i = 0; i < days; i++) {
    const date = calendarDateForDay(anchor, i);
    out[date] = await apiGet<PlanDaySoldiers>(
      `/api/plan/preview-availability?date=${encodeURIComponent(date)}`,
    );
  }
  return out;
}

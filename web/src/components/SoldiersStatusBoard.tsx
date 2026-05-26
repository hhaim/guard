import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { apiGet } from "../api";
import { fetchPlanContext } from "../api/plan";
import { formatPartialWindows } from "../lib/planDayBounds";
import { calendarDateForDay, parsePlanDayStart } from "../lib/planDay";
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
  summary?: PlanDaySoldiersSummary;
};

type Props = {
  soldiers: Soldier[];
  planDayStart?: string;
};

function classify(soldierId: string, day: PlanDaySoldiers): "full" | "partial" | "absent" {
  if (day.avail_full?.includes(soldierId)) return "full";
  if (day.avail_partial && soldierId in day.avail_partial) return "partial";
  return "absent";
}

function cellTitle(soldierId: string, day: PlanDaySoldiers, kind: string): string {
  if (kind === "partial") {
    const w = day.avail_partial?.[soldierId];
    return w ? `Assignable: ${formatPartialWindows(w)}` : "Partial";
  }
  return kind === "full" ? "Full plan day" : "Absent full plan day";
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

  return (
    <>
      <section className="glass-card contacts-list-card status-board" aria-label="Status board">
        <header className="status-board-header">
          <div>
            <h3 className="contacts-title">Status board</h3>
            <p className="contacts-count">
              Next 7 plan days from {anchor || "…"} · {startLabel} → {startLabel} next day
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

        {previewsQ.isLoading && <p className="contacts-empty">Loading availability…</p>}
        {!previewsQ.isLoading && sorted.length > 0 && (
          <div className="status-board-scroll">
            <table className="contacts-table status-board-table">
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
                {sorted.map((s) => (
                  <tr key={s.id}>
                    <td className="status-board-name">{s.full_name.trim() || s.id}</td>
                    {dayColumns.map((c) => {
                      const day = previewsQ.data?.[c.date];
                      const kind = day ? classify(s.id, day) : "full";
                      return (
                        <td key={c.date}>
                          <button
                            type="button"
                            className={`status-chip status-chip--${kind}`}
                            title={day ? cellTitle(s.id, day, kind) : "Tap to set status"}
                            onClick={() =>
                              setCellSheet({
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
        )}
        <p className="contacts-hint status-board-foot">
          Tap a cell to mark away, sick, training, return time, or an outing. Uses plan-day windows, not midnight.
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

/** §7.3 — green / red / yellow availability counts per plan day. */
export function AvailabilityBadges({
  soldiersByDay,
  label = "Availability",
}: {
  soldiersByDay?: Record<string, PlanDaySoldiers>;
  label?: string;
}) {
  if (!soldiersByDay || Object.keys(soldiersByDay).length === 0) return null;
  return (
    <div className="availability-badges" role="group" aria-label={label}>
      <span className="run-field-label title availability-badges-title">{label}</span>
      <div className="availability-badges-row">
        {Object.entries(soldiersByDay).map(([date, day]) => (
          <div key={date} className="availability-badge-group">
            <span className="availability-badge-date">{date.slice(5)}</span>
            <span className="availability-badge availability-badge--full" title="Full plan day">
              {day.summary?.full ?? day.avail_full?.length ?? 0}
            </span>
            <span className="availability-badge availability-badge--absent" title="Absent full plan day">
              {day.summary?.absent_full ?? 0}
            </span>
            <span className="availability-badge availability-badge--partial" title="Partial">
              {day.summary?.absent_partial ?? 0}
            </span>
          </div>
        ))}
      </div>
      <span className="availability-legend">
        <span className="availability-badge availability-badge--full">full</span>
        <span className="availability-badge availability-badge--absent">absent</span>
        <span className="availability-badge availability-badge--partial">partial</span>
      </span>
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

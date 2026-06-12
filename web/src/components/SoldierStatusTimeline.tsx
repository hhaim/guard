import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteSoldierStatus,
  listSoldierStatus,
  patchSoldierStatus,
  type SoldierStatusEntry,
} from "../api/soldierStatus";
import { planDayBoundsIso } from "../lib/planDayBounds";
import { nowFakeUtcIso } from "../lib/wallClock";

type Props = {
  soldierId: string;
  anchorDate: string;
  planDayStartHour: number;
  weekDays?: number;
};

function formatRange(e: SoldierStatusEntry): string {
  const s = new Date(e.start_at).toISOString().replace("T", " ").slice(0, 16);
  const end = e.end_at
    ? new Date(e.end_at).toISOString().replace("T", " ").slice(0, 16)
    : "open";
  return `${s} → ${end}`;
}

export function SoldierStatusTimeline({
  soldierId,
  anchorDate,
  planDayStartHour,
  weekDays = 14,
}: Props) {
  const qc = useQueryClient();
  const rangeStart = planDayBoundsIso(anchorDate, planDayStartHour).start;
  const endDate = new Date(`${anchorDate}T00:00:00.000Z`);
  endDate.setUTCDate(endDate.getUTCDate() + weekDays);
  const rangeEnd = planDayBoundsIso(endDate.toISOString().slice(0, 10), planDayStartHour).end;

  const entriesQ = useQuery({
    queryKey: ["soldiers", "status", soldierId, rangeStart, rangeEnd],
    enabled: Boolean(soldierId),
    queryFn: () => listSoldierStatus(rangeStart, rangeEnd, soldierId),
  });

  const delM = useMutation({
    mutationFn: (e: SoldierStatusEntry) => {
      if (!e.id) throw new Error("Not editable");
      return deleteSoldierStatus(e.id, e.start_at);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["soldiers", "status"] });
      void qc.invalidateQueries({ queryKey: ["plan", "preview-availability"] });
    },
  });

  const closeM = useMutation({
    mutationFn: (e: SoldierStatusEntry) => {
      if (!e.id) throw new Error("Not editable");
      return patchSoldierStatus(e.id, e.start_at, {
        end_at: nowFakeUtcIso(),
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["soldiers", "status"] });
      void qc.invalidateQueries({ queryKey: ["plan", "preview-availability"] });
    },
  });

  const rows = entriesQ.data ?? [];

  return (
    <section className="glass-card soldier-timeline" aria-label="Status timeline">
      <p className="settings-section-header">Status timeline</p>
      {entriesQ.isLoading && <p className="contacts-hint">Loading entries…</p>}
      {!entriesQ.isLoading && rows.length === 0 && (
        <p className="contacts-hint">No status entries in this range.</p>
      )}
      <ul className="soldier-timeline-list">
        {rows.map((e) => (
          <li key={`${e.id ?? "r"}-${e.start_at}-${e.status}`} className="soldier-timeline-row">
            <div>
              <strong className="soldier-timeline-status">{e.status}</strong>
              <span className="contacts-hint soldier-timeline-range">{formatRange(e)}</span>
              {e.note ? <span className="contacts-hint"> — {e.note}</span> : null}
              {!e.editable && (
                <span className="soldier-timeline-resolved"> (archived)</span>
              )}
            </div>
            {e.editable && (
              <div className="soldier-timeline-actions">
                {!e.end_at && (
                  <button
                    type="button"
                    className="btn btn-plain btn-sm"
                    disabled={closeM.isPending}
                    onClick={() => closeM.mutate(e)}
                  >
                    Close now
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-plain btn-sm btn-destructive-text"
                  disabled={delM.isPending}
                  onClick={() => {
                    if (confirm("Delete this status entry?")) delM.mutate(e);
                  }}
                >
                  Delete
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

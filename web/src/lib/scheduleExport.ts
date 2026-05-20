import YAML from "yaml";
import type { ScheduleReportRow } from "./scheduleRows";

export function scheduleRowsToYaml(rows: ScheduleReportRow[], from: string, to: string): string {
  const doc = {
    exported_at: new Date().toISOString(),
    range: { from, to },
    row_count: rows.length,
    rows: rows.map((r) => ({
      ts_date: r.ts_date.slice(0, 10),
      day_index: r.day_index,
      slot: r.slot,
      shift_index: r.shift_index,
      shift_start: r.shift_start,
      shift_end: r.shift_end,
      soldier_id: r.soldier_id,
      meta: r.meta ?? {},
    })),
  };
  return YAML.stringify(doc);
}

export function downloadTextFile(filename: string, content: string, mime = "text/yaml") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

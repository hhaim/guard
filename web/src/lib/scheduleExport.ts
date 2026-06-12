import YAML from "yaml";
import type { PlanDoc } from "./planDoc";

export function planDocToYaml(doc: PlanDoc, from: string, to: string): string {
  const exportDoc = {
    exported_at: new Date().toISOString(),
    range: { from, to },
    plan: doc,
  };
  return YAML.stringify(exportDoc);
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

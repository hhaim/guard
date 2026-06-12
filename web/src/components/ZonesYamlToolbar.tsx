import { Download, Upload } from "lucide-react";
import { pickTextFile, downloadText } from "../lib/fileIo";
import { parseZonesYaml, stringifyZonesYaml, type ZonesDoc } from "../lib/zones";

type ZonesYamlToolbarProps = {
  disabled?: boolean;
  onImport: (doc: ZonesDoc) => void;
  doc: ZonesDoc | null;
};

export function ZonesYamlToolbar({ disabled, onImport, doc }: ZonesYamlToolbarProps) {
  const importYaml = async () => {
    try {
      const text = await pickTextFile(".yaml,.yml,text/yaml,text/plain");
      const parsed = parseZonesYaml(text);
      if (!confirm("Import YAML? This replaces all slot types, zone locations, slots, and time zones.")) {
        return;
      }
      onImport(parsed);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Import failed");
    }
  };

  const exportYaml = () => {
    if (!doc) return;
    downloadText(`zones-${new Date().toISOString().slice(0, 10)}.yaml`, stringifyZonesYaml(doc), "text/yaml");
  };

  return (
    <div className="zones-io-row">
      <button
        type="button"
        className="btn btn-tinted"
        disabled={disabled}
        onClick={() => importYaml()}
      >
        <Upload size={16} strokeWidth={2} />
        <span className="zones-io-label">Import YAML</span>
      </button>
      <button
        type="button"
        className="btn btn-tinted"
        disabled={disabled || !doc}
        onClick={() => exportYaml()}
      >
        <Download size={16} strokeWidth={2} />
        <span className="zones-io-label">Export YAML</span>
      </button>
    </div>
  );
}

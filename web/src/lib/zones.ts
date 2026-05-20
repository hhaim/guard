import YAML from "yaml";

export type SlotTypePattern = "rotating" | "full_day" | "windowed_slots";

export type FullDayConfig = {
  start: string;
  end: string;
  rest_after_hours: number;
  weight_multiplier: number;
};

export type WindowedWindow = {
  name: string;
  start: string;
  end: string;
  weight_multiplier: number;
};

export type WindowedSlotsConfig = {
  slots: WindowedWindow[];
};

export const DEFAULT_FULL_DAY_CONFIG: FullDayConfig = {
  start: "06:00",
  end: "22:00",
  rest_after_hours: 6,
  weight_multiplier: 1,
};

export const DEFAULT_WINDOWED_WINDOW: WindowedWindow = {
  name: "w1",
  start: "00:00",
  end: "12:00",
  weight_multiplier: 1,
};

export const DEFAULT_WINDOWED_SLOTS_CONFIG: WindowedSlotsConfig = {
  slots: [DEFAULT_WINDOWED_WINDOW],
};

export type SlotType = {
  id: string;
  name: string;
  pattern: SlotTypePattern;
  full_day_shift?: number;
  rest_after_hours?: number;
  config?: Record<string, unknown>;
};

function asConfigNum(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function asConfigTime(v: unknown, fallback: string): string {
  const s = v == null ? "" : String(v).trim();
  return s || fallback;
}

export function parseFullDayConfig(config: Record<string, unknown> | undefined): FullDayConfig {
  const c = config ?? {};
  return {
    start: asConfigTime(c.start, DEFAULT_FULL_DAY_CONFIG.start),
    end: asConfigTime(c.end, DEFAULT_FULL_DAY_CONFIG.end),
    rest_after_hours: asConfigNum(c.rest_after_hours ?? c.rest_after, DEFAULT_FULL_DAY_CONFIG.rest_after_hours),
    weight_multiplier: asConfigNum(
      c.weight_multiplier ?? c.weight_mult ?? c.w_mult,
      DEFAULT_FULL_DAY_CONFIG.weight_multiplier
    ),
  };
}

export function fullDayConfigToRecord(cfg: FullDayConfig): Record<string, unknown> {
  return {
    start: cfg.start,
    end: cfg.end,
    rest_after_hours: cfg.rest_after_hours,
    weight_multiplier: cfg.weight_multiplier,
  };
}

export function parseWindowedSlotsConfig(config: Record<string, unknown> | undefined): WindowedSlotsConfig {
  const raw = config?.slots;
  if (!Array.isArray(raw) || raw.length === 0) {
    return structuredClone(DEFAULT_WINDOWED_SLOTS_CONFIG);
  }
  const slots = raw
    .filter((x): x is Record<string, unknown> => x != null && typeof x === "object" && !Array.isArray(x))
    .map((w, i) => ({
      name: asConfigTime(w.name, `w${i + 1}`),
      start: asConfigTime(w.start, DEFAULT_WINDOWED_WINDOW.start),
      end: asConfigTime(w.end, DEFAULT_WINDOWED_WINDOW.end),
      weight_multiplier: asConfigNum(w.weight_multiplier ?? w.weight_mult, DEFAULT_WINDOWED_WINDOW.weight_multiplier),
    }));
  return { slots: slots.length > 0 ? slots : structuredClone(DEFAULT_WINDOWED_SLOTS_CONFIG.slots) };
}

export function windowedSlotsConfigToRecord(cfg: WindowedSlotsConfig): Record<string, unknown> {
  return {
    slots: cfg.slots.map((w) => ({
      name: w.name,
      start: w.start,
      end: w.end,
      weight_multiplier: w.weight_multiplier,
    })),
  };
}

/** Zone location row (YAML `zone_loc`). */
export type ZoneLoc = {
  id: string;
  type: string;
  name: string;
  full_name: string;
  weight: number;
};

/** @deprecated use ZoneLoc */
export type ZoneLocation = ZoneLoc;

export type ZoneSlot = {
  location_id: string;
  name: string;
  full_name: string;
};

export type TimeBand = {
  id: string;
  name: string;
  weight: number;
  from_hour: number;
  to_hour: number;
};

export type ZonesDoc = {
  schema_version: number;
  shift_hours: number;
  slots_types: SlotType[];
  zone_loc: ZoneLoc[];
  slots: ZoneSlot[];
  time_zones: TimeBand[];
};

export const ALLOWED_SHIFT_HOURS = [2, 3, 4] as const;

export function normalizeShiftHours(value: number, fallback = 3): number {
  const n = Math.round(value);
  if (ALLOWED_SHIFT_HOURS.includes(n as (typeof ALLOWED_SHIFT_HOURS)[number])) return n;
  const fb = Math.round(fallback);
  if (ALLOWED_SHIFT_HOURS.includes(fb as (typeof ALLOWED_SHIFT_HOURS)[number])) return fb;
  return 3;
}

export function validateShiftHours(value: number): number {
  const n = Math.round(value);
  if (!ALLOWED_SHIFT_HOURS.includes(n as (typeof ALLOWED_SHIFT_HOURS)[number])) {
    throw new Error(`shift_hours must be 2, 3, or 4 (got ${value})`);
  }
  return n;
}

function parseShiftHours(raw: unknown, fallback: number): number {
  if (raw == null || raw === "") return normalizeShiftHours(fallback);
  return normalizeShiftHours(asNum(raw, fallback), fallback);
}

export const DEFAULT_ZONES: ZonesDoc = {
  schema_version: 2,
  shift_hours: 3,
  slots_types: [{ id: "rotating_slot", name: "Rotating Guard", pattern: "rotating" }],
  zone_loc: [],
  slots: [],
  time_zones: [
    { id: "zt_night", name: "Night", weight: 1.5, from_hour: 0, to_hour: 5 },
    { id: "zt_day", name: "Day", weight: 1.0, from_hour: 6, to_hour: 23 },
  ],
};

export const SLOT_PATTERNS: { value: SlotTypePattern; label: string }[] = [
  { value: "rotating", label: "Rotating" },
  { value: "full_day", label: "Full day" },
  { value: "windowed_slots", label: "Windowed slots" },
];

function asStr(v: unknown, fallback = ""): string {
  return v == null ? fallback : String(v).trim();
}

function asNum(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function zoneLocRaw(raw: Record<string, unknown>): unknown[] {
  if (Array.isArray(raw.zone_loc)) return raw.zone_loc;
  if (Array.isArray(raw.locations)) return raw.locations;
  if (Array.isArray(raw.location_zones)) return raw.location_zones;
  return [];
}

function parseSlotType(raw: Record<string, unknown>): SlotType {
  const pattern = asStr(raw.pattern, "rotating") as SlotTypePattern;
  const st: SlotType = {
    id: asStr(raw.id),
    name: asStr(raw.name),
    pattern,
  };
  if (raw.full_day_shift != null) st.full_day_shift = asNum(raw.full_day_shift, 1);
  if (raw.rest_after_hours != null) st.rest_after_hours = asNum(raw.rest_after_hours, 6);
  if (raw.config != null && typeof raw.config === "object" && !Array.isArray(raw.config)) {
    st.config = raw.config as Record<string, unknown>;
  }
  return st;
}

export function parseZonesYaml(text: string): ZonesDoc {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      ...DEFAULT_ZONES,
      slots_types: [...DEFAULT_ZONES.slots_types],
      time_zones: [...DEFAULT_ZONES.time_zones],
    };
  }
  const raw = YAML.parse(trimmed) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") {
    throw new Error("YAML root must be a mapping");
  }

  return {
    schema_version: asNum(raw.schema_version, 2),
    shift_hours: parseShiftHours(raw.shift_hours, 3),
    slots_types: (Array.isArray(raw.slots_types) ? raw.slots_types : [])
      .filter((x): x is Record<string, unknown> => x != null && typeof x === "object" && !Array.isArray(x))
      .map(parseSlotType)
      .filter((s) => s.id !== ""),
    zone_loc: zoneLocRaw(raw)
      .filter((x): x is Record<string, unknown> => x != null && typeof x === "object" && !Array.isArray(x))
      .map((m) => {
        const id = asStr(m.id);
        const name = asStr(m.name) || id;
        const full_name = asStr(m.full_name) || name;
        return {
          id,
          type: asStr(m.type),
          name,
          full_name,
          weight: asNum(m.weight, 1),
        };
      })
      .filter((l) => l.id !== ""),
    slots: (Array.isArray(raw.slots) ? raw.slots : [])
      .filter((x): x is Record<string, unknown> => x != null && typeof x === "object" && !Array.isArray(x))
      .map((m) => {
        const name = asStr(m.name);
        const full_name = asStr(m.full_name) || name;
        return {
          location_id: asStr(m.location_id),
          name,
          full_name,
        };
      })
      .filter((s) => s.location_id !== ""),
    time_zones: (Array.isArray(raw.time_zones) ? raw.time_zones : [])
      .filter((x): x is Record<string, unknown> => x != null && typeof x === "object" && !Array.isArray(x))
      .map((m) => ({
        id: asStr(m.id),
        name: asStr(m.name) || asStr(m.id),
        weight: asNum(m.weight, 1),
        from_hour: asNum(m.from_hour, 0),
        to_hour: asNum(m.to_hour, 23),
      }))
      .filter((t) => t.id !== ""),
  };
}

function slotTypeToYaml(st: SlotType): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: st.id,
    name: st.name,
    pattern: st.pattern,
  };
  if (st.full_day_shift != null) row.full_day_shift = st.full_day_shift;
  if (st.rest_after_hours != null) row.rest_after_hours = st.rest_after_hours;
  if (st.config && Object.keys(st.config).length > 0) row.config = st.config;
  return row;
}

function slotToYaml(s: ZoneSlot): Record<string, unknown> {
  const row: Record<string, unknown> = {
    location_id: s.location_id,
    name: s.name,
  };
  if (s.full_name && s.full_name !== s.name) {
    row.full_name = s.full_name;
  }
  return row;
}

function zoneLocToYaml(l: ZoneLoc): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: l.id,
    type: l.type,
    name: l.name,
    weight: l.weight,
  };
  if (l.full_name && l.full_name !== l.name) {
    row.full_name = l.full_name;
  }
  return row;
}

export function zonesDocToYamlObject(doc: ZonesDoc): Record<string, unknown> {
  return {
    schema_version: doc.schema_version,
    shift_hours: normalizeShiftHours(doc.shift_hours),
    slots_types: doc.slots_types.map(slotTypeToYaml),
    slots: doc.slots.map(slotToYaml),
    zone_loc: doc.zone_loc.map(zoneLocToYaml),
    time_zones: doc.time_zones.map((t) => ({
      id: t.id,
      name: t.name,
      weight: t.weight,
      from_hour: t.from_hour,
      to_hour: t.to_hour,
    })),
  };
}

export function stringifyZonesYaml(doc: ZonesDoc): string {
  return YAML.stringify(zonesDocToYamlObject(doc), { lineWidth: 0 });
}

export function cfgValueToYamlText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.zones_yaml === "string") return o.zones_yaml;
  }
  return "";
}

export function docFromCfgValue(value: unknown): ZonesDoc {
  const yamlText = cfgValueToYamlText(value);
  if (!yamlText.trim()) return structuredClone(DEFAULT_ZONES);
  try {
    return parseZonesYaml(yamlText);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Invalid zones YAML from server: ${msg}`);
  }
}

export function docToCfgValue(doc: ZonesDoc): { update_ts: string; zones_yaml: string } {
  return {
    update_ts: new Date().toISOString(),
    zones_yaml: stringifyZonesYaml(doc),
  };
}

export function zoneLocCountForType(doc: ZonesDoc, typeId: string): number {
  return doc.zone_loc.filter((l) => l.type === typeId).length;
}

/** @deprecated use zoneLocCountForType */
export const locationCountForType = zoneLocCountForType;

export function slotCountForLocation(doc: ZonesDoc, locationId: string): number {
  return doc.slots.filter((s) => s.location_id === locationId).length;
}

export function validateZonesDoc(doc: ZonesDoc): string | null {
  try {
    validateShiftHours(doc.shift_hours);
  } catch (e) {
    return e instanceof Error ? e.message : "shift_hours must be 2, 3, or 4";
  }
  const typeIds = new Set<string>();
  for (const st of doc.slots_types) {
    if (!st.id) return "Slot type missing id";
    if (typeIds.has(st.id)) return `Duplicate slot type id: ${st.id}`;
    typeIds.add(st.id);
  }
  const locIds = new Set<string>();
  for (const loc of doc.zone_loc) {
    if (!loc.id) return "Zone location missing id";
    if (locIds.has(loc.id)) return `Duplicate zone location id: ${loc.id}`;
    if (!typeIds.has(loc.type)) return `Zone location ${loc.id} references unknown type ${loc.type}`;
    locIds.add(loc.id);
  }
  for (const sl of doc.slots) {
    if (!sl.location_id) return "Slot missing location_id";
    if (!locIds.has(sl.location_id)) {
      return `Slot ${sl.name} references unknown location ${sl.location_id}`;
    }
  }
  const tzIds = new Set<string>();
  for (const tz of doc.time_zones) {
    if (!tz.id) return "Time zone missing id";
    if (tzIds.has(tz.id)) return `Duplicate time zone id: ${tz.id}`;
    tzIds.add(tz.id);
  }
  return null;
}

export function emptySlotType(index: number): SlotType {
  return { id: `type_${index}`, name: "New type", pattern: "rotating" };
}

export function emptyZoneLoc(index: number, typeId: string): ZoneLoc {
  const name = "New location";
  return { id: `loc_${index}`, type: typeId, name, full_name: name, weight: 1 };
}

/** @deprecated use emptyZoneLoc */
export const emptyLocation = emptyZoneLoc;

export function emptySlot(locationId: string, index: number): ZoneSlot {
  const name = `s${index}`;
  return { location_id: locationId, name, full_name: name };
}

export function emptyTimeBand(index: number): TimeBand {
  return { id: `zt_${index}`, name: "New band", weight: 1, from_hour: 0, to_hour: 23 };
}

export function slotDisplayLabel(s: ZoneSlot): string {
  return s.full_name.trim() || s.name.trim() || s.location_id;
}

export function zoneLocDisplayLabel(l: ZoneLoc): string {
  return l.full_name.trim() || l.name.trim() || l.id;
}

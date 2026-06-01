import YAML from "yaml";

export type SlotTypePattern = "rotating" | "full_day" | "full_day_team" | "windowed_slots";

export const WEEKDAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export type WeekdayName = (typeof WEEKDAY_NAMES)[number];

export type FullDayConfig = {
  start: string;
  end: string;
  rest_after_hours: number;
  weight_multiplier: number;
  headcount: number;
};

export type WindowedWindow = {
  name: string;
  start: string;
  end: string;
  weight_multiplier: number;
};

export type WindowedSlotsConfig = {
  slots: WindowedWindow[];
  headcount: number;
};

export const DEFAULT_FULL_DAY_CONFIG: FullDayConfig = {
  start: "06:00",
  end: "22:00",
  rest_after_hours: 6,
  weight_multiplier: 1,
  headcount: 1,
};

export const DEFAULT_WINDOWED_WINDOW: WindowedWindow = {
  name: "w1",
  start: "00:00",
  end: "12:00",
  weight_multiplier: 1,
};

export const DEFAULT_WINDOWED_SLOTS_CONFIG: WindowedSlotsConfig = {
  slots: [DEFAULT_WINDOWED_WINDOW],
  headcount: 1,
};

export type FullDayTeamConfig = FullDayConfig & {
  headcount: number;
  type_quotas: Record<string, number>;
  /** Credited duty fraction for fairness (default 1); busy span unchanged. */
  hours_factor: number;
};

export const DEFAULT_FULL_DAY_TEAM_CONFIG: FullDayTeamConfig = {
  ...DEFAULT_FULL_DAY_CONFIG,
  headcount: 1,
  type_quotas: {},
  hours_factor: 1,
};

export type SlotType = {
  id: string;
  name: string;
  pattern: SlotTypePattern;
  full_day_shift?: number;
  rest_after_hours?: number;
  disabled_weekdays?: WeekdayName[];
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
    headcount: Math.max(1, Math.round(asConfigNum(c.headcount, DEFAULT_FULL_DAY_CONFIG.headcount))),
  };
}

export function fullDayConfigToRecord(cfg: FullDayConfig): Record<string, unknown> {
  return {
    start: cfg.start,
    end: cfg.end,
    rest_after_hours: cfg.rest_after_hours,
    weight_multiplier: cfg.weight_multiplier,
    headcount: cfg.headcount,
  };
}

export function parseFullDayTeamConfig(config: Record<string, unknown> | undefined): FullDayTeamConfig {
  const base = parseFullDayConfig(config);
  const c = config ?? {};
  const rawQuotas = c.type_quotas;
  const type_quotas: Record<string, number> = {};
  if (rawQuotas != null && typeof rawQuotas === "object" && !Array.isArray(rawQuotas)) {
    for (const [k, v] of Object.entries(rawQuotas as Record<string, unknown>)) {
      const code = String(k).trim();
      if (!code) continue;
      const q = asConfigNum(v, 0);
      if (q >= 1) type_quotas[code] = Math.round(q);
    }
  }
  return {
    ...base,
    headcount: Math.max(1, Math.round(asConfigNum(c.headcount, DEFAULT_FULL_DAY_TEAM_CONFIG.headcount))),
    type_quotas,
    hours_factor: asConfigNum(c.hours_factor, DEFAULT_FULL_DAY_TEAM_CONFIG.hours_factor),
  };
}

export function fullDayTeamConfigToRecord(cfg: FullDayTeamConfig): Record<string, unknown> {
  const row: Record<string, unknown> = fullDayConfigToRecord(cfg);
  row.headcount = cfg.headcount;
  if (cfg.hours_factor !== 1) {
    row.hours_factor = cfg.hours_factor;
  }
  if (Object.keys(cfg.type_quotas).length > 0) {
    row.type_quotas = cfg.type_quotas;
  }
  return row;
}

export function parseWindowedSlotsConfig(config: Record<string, unknown> | undefined): WindowedSlotsConfig {
  const raw = config?.slots;
  const c = config ?? {};
  if (!Array.isArray(raw) || raw.length === 0) {
    return {
      ...structuredClone(DEFAULT_WINDOWED_SLOTS_CONFIG),
      headcount: Math.max(1, Math.round(asConfigNum(c.headcount, DEFAULT_WINDOWED_SLOTS_CONFIG.headcount))),
    };
  }
  const slots = raw
    .filter((x): x is Record<string, unknown> => x != null && typeof x === "object" && !Array.isArray(x))
    .map((w, i) => ({
      name: asConfigTime(w.name, `w${i + 1}`),
      start: asConfigTime(w.start, DEFAULT_WINDOWED_WINDOW.start),
      end: asConfigTime(w.end, DEFAULT_WINDOWED_WINDOW.end),
      weight_multiplier: asConfigNum(w.weight_multiplier ?? w.weight_mult, DEFAULT_WINDOWED_WINDOW.weight_multiplier),
    }));
  return {
    slots: slots.length > 0 ? slots : structuredClone(DEFAULT_WINDOWED_SLOTS_CONFIG.slots),
    headcount: Math.max(1, Math.round(asConfigNum(c.headcount, DEFAULT_WINDOWED_SLOTS_CONFIG.headcount))),
  };
}

export function windowedSlotsConfigToRecord(cfg: WindowedSlotsConfig): Record<string, unknown> {
  return {
    headcount: cfg.headcount,
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
  soldiers_required?: number;
};

export type TimeBand = {
  id: string;
  name: string;
  weight: number;
  /** Wall-clock start (inclusive): hour int shorthand or "HH:MM". */
  from_hour: number | string;
  /** Wall-clock end (exclusive): hour int, "HH:MM", or "24:00". */
  to_hour: number | string;
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

export type ParseWallClockHourResult =
  | { ok: true; hour: number }
  | { ok: false; error: string };

/** Parse HH:MM wall-clock (whole hours only). Optional 24:00 when allow24. */
export function parseWallClockHour(s: string, opts?: { allow24?: boolean }): ParseWallClockHourResult {
  const raw = s.trim();
  if (!raw) {
    return { ok: false, error: "Time is required (HH:MM)" };
  }
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(raw);
  if (!m) {
    return { ok: false, error: `Invalid time ${JSON.stringify(s)} (use HH:MM)` };
  }
  const hour = Number(m[1]);
  const min = m[2] != null ? Number(m[2]) : 0;
  if (!Number.isFinite(hour) || !Number.isFinite(min)) {
    return { ok: false, error: `Invalid time ${JSON.stringify(s)}` };
  }
  if (min !== 0) {
    return { ok: false, error: `${s} must use whole hours (:00 only)` };
  }
  if (hour === 24) {
    if (!opts?.allow24) {
      return { ok: false, error: "24:00 is only allowed as a window end" };
    }
    return { ok: true, hour: 24 };
  }
  if (hour < 0 || hour > 23) {
    return { ok: false, error: `Hour out of range in ${JSON.stringify(s)}` };
  }
  return { ok: true, hour };
}

export const PATTERN_WALL_CLOCK_HINT =
  "Whole hours only (HH:00). Minutes must be :00; use 24:00 for window end.";

/** Parse YAML time_zones bound to minutes [0, 1440]. */
export function parseTimeBandBound(v: number | string): number {
  if (typeof v === "number") {
    if (!Number.isFinite(v) || !Number.isInteger(v)) {
      throw new Error(`time band bound ${v} must be a whole hour`);
    }
    return v * 60;
  }
  const p = parseWallClockHour(String(v), { allow24: true });
  if (!p.ok) throw new Error(p.error);
  return p.hour * 60;
}

export function timeBandContainsStartMin(fromMin: number, toExclMin: number, startMin: number): boolean {
  const t = ((startMin % 1440) + 1440) % 1440;
  if (fromMin < toExclMin) return t >= fromMin && t < toExclMin;
  if (fromMin === toExclMin) return false;
  return t >= fromMin || t < toExclMin;
}

/** Sort/display label for a time_zones bound (int hour or HH:MM). */
export function formatTimeBandBound(v: number | string): string {
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "24" || s === "24:00" || s === "24:0") return "24:00";
    return s.includes(":") ? s : `${s}:00`;
  }
  if (v === 24) return "24:00";
  return `${v}:00`;
}

export function timeBandBoundSortKey(v: number | string): number {
  return parseTimeBandBound(v);
}

export function timeBandSpanHours(fromMin: number, toExclMin: number): number {
  let span: number;
  if (fromMin < toExclMin) span = toExclMin - fromMin;
  else if (fromMin === toExclMin) return 0;
  else span = 1440 - fromMin + toExclMin;
  return span / 60;
}

/** Validate full_day / windowed_slots wall-clock times (whole hours; matches simulator). */
export function validateSlotTypePattern(st: SlotType): string | null {
  const label = st.name.trim() || st.id || "slot type";

  if (st.pattern === "full_day" || st.pattern === "full_day_team") {
    const cfg =
      st.pattern === "full_day_team" ? parseFullDayTeamConfig(st.config) : parseFullDayConfig(st.config);
    const start = parseWallClockHour(cfg.start);
    if (!start.ok) return `${st.pattern} "${label}": start — ${start.error}`;
    const end = parseWallClockHour(cfg.end);
    if (!end.ok) return `${st.pattern} "${label}": end — ${end.error}`;
    if (st.pattern === "full_day" && cfg.headcount < 1) {
      return `full_day "${label}": headcount must be >= 1`;
    }
    if (st.pattern === "full_day_team") {
      const team = cfg as FullDayTeamConfig;
      if (team.hours_factor <= 0) {
        return `full_day_team "${label}": hours_factor must be > 0`;
      }
      let sumQ = 0;
      for (const q of Object.values(team.type_quotas)) sumQ += q;
      if (sumQ > team.headcount) {
        return `full_day_team "${label}": sum(type_quotas)=${sumQ} exceeds headcount=${team.headcount}`;
      }
    }
    return null;
  }

  if (st.disabled_weekdays?.length) {
    const seen = new Set<string>();
    for (const d of st.disabled_weekdays) {
      if (!WEEKDAY_NAMES.includes(d)) {
        return `slot type "${label}": invalid disabled weekday ${JSON.stringify(d)}`;
      }
      if (seen.has(d)) return `slot type "${label}": duplicate disabled weekday ${d}`;
      seen.add(d);
    }
  }

  if (st.pattern === "windowed_slots") {
    const cfg = parseWindowedSlotsConfig(st.config);
    if (cfg.headcount < 1) {
      return `windowed_slots "${label}": headcount must be >= 1`;
    }
    for (let i = 0; i < cfg.slots.length; i++) {
      const w = cfg.slots[i];
      const wn = w.name.trim() || `window ${i + 1}`;
      const start = parseWallClockHour(w.start);
      if (!start.ok) return `windowed_slots "${label}" ${wn}: start — ${start.error}`;
      const end = parseWallClockHour(w.end, { allow24: true });
      if (!end.ok) return `windowed_slots "${label}" ${wn}: end — ${end.error}`;
    }
    return null;
  }

  return null;
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
    { id: "zt_night", name: "Night", weight: 1.5, from_hour: 0, to_hour: "06:00" },
    { id: "zt_day", name: "Day", weight: 1.0, from_hour: "06:00", to_hour: "24:00" },
  ],
};

export const SLOT_PATTERNS: { value: SlotTypePattern; label: string }[] = [
  { value: "rotating", label: "Rotating" },
  { value: "full_day", label: "Full day" },
  { value: "full_day_team", label: "Full day (team)" },
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

function parseDisabledWeekdays(raw: unknown): WeekdayName[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: WeekdayName[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const d = asStr(item).toLowerCase() as WeekdayName;
    if (!WEEKDAY_NAMES.includes(d)) continue;
    if (!seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  return out.length > 0 ? out : undefined;
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
  const dw = parseDisabledWeekdays(raw.disabled_weekdays);
  if (dw) st.disabled_weekdays = dw;
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
        const soldiers_required =
          m.soldiers_required != null ? Math.max(1, Math.round(asNum(m.soldiers_required, 1))) : undefined;
        return {
          location_id: asStr(m.location_id),
          name,
          full_name,
          ...(soldiers_required != null && soldiers_required !== 1 ? { soldiers_required } : {}),
        };
      })
      .filter((s) => s.location_id !== ""),
    time_zones: (Array.isArray(raw.time_zones) ? raw.time_zones : [])
      .filter((x): x is Record<string, unknown> => x != null && typeof x === "object" && !Array.isArray(x))
      .map((m) => ({
        id: asStr(m.id),
        name: asStr(m.name) || asStr(m.id),
        weight: asNum(m.weight, 1),
        from_hour: m.from_hour != null ? (typeof m.from_hour === "string" ? m.from_hour : asNum(m.from_hour, 0)) : 0,
        to_hour:
          m.to_hour != null
            ? typeof m.to_hour === "string"
              ? m.to_hour
              : asNum(m.to_hour, 24)
            : "24:00",
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
  if (st.disabled_weekdays?.length) row.disabled_weekdays = [...st.disabled_weekdays];
  if (st.pattern === "full_day") {
    row.config = fullDayConfigToRecord(parseFullDayConfig(st.config));
  } else if (st.pattern === "full_day_team") {
    row.config = fullDayTeamConfigToRecord(parseFullDayTeamConfig(st.config));
  } else if (st.config && Object.keys(st.config).length > 0) {
    row.config = st.config;
  }
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
  if (s.soldiers_required != null && s.soldiers_required > 1) {
    row.soldiers_required = s.soldiers_required;
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
    if (sl.soldiers_required != null && sl.soldiers_required < 1) {
      return `Slot ${sl.name}: soldiers_required must be >= 1`;
    }
  }
  const tzIds = new Set<string>();
  for (const tz of doc.time_zones) {
    if (!tz.id) return "Time zone missing id";
    if (tzIds.has(tz.id)) return `Duplicate time zone id: ${tz.id}`;
    tzIds.add(tz.id);
  }
  for (const st of doc.slots_types) {
    const patErr = validateSlotTypePattern(st);
    if (patErr) return patErr;
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
  return { id: `zt_${index}`, name: "New band", weight: 1, from_hour: 0, to_hour: "24:00" };
}

export function slotDisplayLabel(s: ZoneSlot): string {
  return s.full_name.trim() || s.name.trim() || s.location_id;
}

export function zoneLocDisplayLabel(l: ZoneLoc): string {
  return l.full_name.trim() || l.name.trim() || l.id;
}

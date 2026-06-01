import { SOLDIER_BADGE_COLORS } from "./soldierDisplay";

export type PlatoonColorEntry = {
  code: string;
  bg: string;
  fg?: string;
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return null;
  const n = Number.parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Relative luminance (sRGB) for contrast picking. */
function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

export function contrastForeground(bg: string): string {
  return luminance(bg) > 0.45 ? "#1f2937" : "#f9fafb";
}

export function isValidCssHexColor(value: string): boolean {
  return HEX_RE.test(value.trim());
}

function normalizeEntry(raw: Record<string, unknown>): PlatoonColorEntry | null {
  const code = String(raw.code ?? "").trim();
  const bg = String(raw.bg ?? "").trim();
  if (!code || !isValidCssHexColor(bg)) return null;
  const fgRaw = raw.fg != null ? String(raw.fg).trim() : "";
  const fg = fgRaw && isValidCssHexColor(fgRaw) ? fgRaw : undefined;
  return { code, bg, ...(fg ? { fg } : {}) };
}

export function parsePlatoonColorsFromGlobal(value: unknown): PlatoonColorEntry[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const list = (value as Record<string, unknown>).platoon_colors;
  if (!Array.isArray(list)) return [];
  const out: PlatoonColorEntry[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (item == null || typeof item !== "object" || Array.isArray(item)) continue;
    const entry = normalizeEntry(item as Record<string, unknown>);
    if (!entry || seen.has(entry.code)) continue;
    seen.add(entry.code);
    out.push(entry);
  }
  return out;
}

export function validatePlatoonColors(entries: PlatoonColorEntry[]): string | null {
  for (const e of entries) {
    if (!e.code.trim()) return "Platoon color entry needs a code.";
    if (!isValidCssHexColor(e.bg)) return `Invalid background color for platoon "${e.code}" (use #rrggbb).`;
    if (e.fg != null && !isValidCssHexColor(e.fg)) {
      return `Invalid text color for platoon "${e.code}" (use #rrggbb).`;
    }
  }
  return null;
}

export function platoonBadgeStyle(
  code: string,
  colors: PlatoonColorEntry[],
  fallbackIndex = 0
): { backgroundColor: string; color: string } {
  const c = code.trim();
  const entry = colors.find((x) => x.code === c);
  if (entry) {
    return {
      backgroundColor: entry.bg,
      color: entry.fg ?? contrastForeground(entry.bg),
    };
  }
  const fb = SOLDIER_BADGE_COLORS[fallbackIndex % SOLDIER_BADGE_COLORS.length];
  return { backgroundColor: fb.bg, color: fb.fg };
}

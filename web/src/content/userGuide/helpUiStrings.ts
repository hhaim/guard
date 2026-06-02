import type { HelpLocale } from "./helpLocale";

export type HelpSectionId =
  | "getting-started"
  | "soldiers"
  | "slots"
  | "tutorial-12x4"
  | "plan-workflow"
  | "stats"
  | "algorithm";

type HelpUiCopy = {
  pageTitle: string;
  pageSubtitle: string;
  contents: string;
  navAria: string;
  languageLabel: string;
  langEn: string;
  langHe: string;
  sectionTitles: Record<HelpSectionId, string>;
};

const COPY: Record<HelpLocale, HelpUiCopy> = {
  en: {
    pageTitle: "Help",
    pageSubtitle:
      "In-app guide for soldiers, zones, planning, and stats. Describes current Plan simulator behavior (hybrid_rel).",
    contents: "Contents",
    navAria: "Help sections",
    languageLabel: "Language",
    langEn: "English",
    langHe: "עברית",
    sectionTitles: {
      "getting-started": "Getting started",
      soldiers: "Soldiers",
      slots: "Slots & patterns",
      "tutorial-12x4": "Tutorial 12×4",
      "plan-workflow": "Plan workflow",
      stats: "Stats tab",
      algorithm: "Fairness & constraints",
    },
  },
  he: {
    pageTitle: "עזרה",
    pageSubtitle:
      "מדריך בתוך האפליקציה לחיילים, אזורים, תכנון וסטטיסטיקה. מתאר את התנהגות מנוע הסימולציה בלשונית תכנון (hybrid_rel).",
    contents: "תוכן עניינים",
    navAria: "פרקי עזרה",
    languageLabel: "שפה",
    langEn: "English",
    langHe: "עברית",
    sectionTitles: {
      "getting-started": "תחילת עבודה",
      soldiers: "חיילים",
      slots: "משבצות ותבניות",
      "tutorial-12x4": "מדריך 12×4",
      "plan-workflow": "תהליך תכנון",
      stats: "לשונית סטטיסטיקה",
      algorithm: "הוגנות ואילוצים",
    },
  },
};

export function helpUi(locale: HelpLocale): HelpUiCopy {
  return COPY[locale];
}

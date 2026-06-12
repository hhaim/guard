import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type HelpLocale = "en" | "he";

const STORAGE_KEY = "guard-help-locale";

function readStoredLocale(): HelpLocale {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "he" || v === "en") return v;
  } catch {
    /* private mode / blocked storage */
  }
  return "en";
}

type HelpLocaleContextValue = {
  locale: HelpLocale;
  setLocale: (locale: HelpLocale) => void;
  dir: "ltr" | "rtl";
};

const HelpLocaleContext = createContext<HelpLocaleContextValue | null>(null);

export function HelpLocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<HelpLocale>(readStoredLocale);

  const setLocale = useCallback((next: HelpLocale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    (): HelpLocaleContextValue => ({
      locale,
      setLocale,
      dir: locale === "he" ? "rtl" : "ltr",
    }),
    [locale, setLocale]
  );

  return <HelpLocaleContext.Provider value={value}>{children}</HelpLocaleContext.Provider>;
}

export function useHelpLocale(): HelpLocaleContextValue {
  const ctx = useContext(HelpLocaleContext);
  if (!ctx) {
    throw new Error("useHelpLocale must be used within HelpLocaleProvider");
  }
  return ctx;
}

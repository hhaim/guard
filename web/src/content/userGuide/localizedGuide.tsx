import type { ComponentType } from "react";
import { useHelpLocale } from "./helpLocale";

export function useLocalizedGuide(En: ComponentType, He: ComponentType): ComponentType {
  const { locale } = useHelpLocale();
  return locale === "he" ? He : En;
}

export function LocalizedGuide({ en: En, he: He }: { en: ComponentType; he: ComponentType }) {
  const { locale } = useHelpLocale();
  const Component = locale === "he" ? He : En;
  return <Component />;
}

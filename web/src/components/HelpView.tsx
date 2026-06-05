import { useEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import { GUIDE_SECTIONS } from "../content/userGuide";
import { HelpLocaleProvider, useHelpLocale, type HelpLocale } from "../content/userGuide/helpLocale";
import { helpUi, type HelpSectionId } from "../content/userGuide/helpUiStrings";

type HelpViewProps = {
  scrollToSection?: string | null;
  onScrolledToSection?: () => void;
  showBackToPlan?: boolean;
  onBackToPlan?: () => void;
};

function HelpLanguageToggle() {
  const { locale, setLocale } = useHelpLocale();
  const ui = helpUi(locale);

  const btn = (lang: HelpLocale, label: string) => (
    <button
      key={lang}
      type="button"
      className={`help-lang-btn${locale === lang ? " active" : ""}`}
      aria-pressed={locale === lang}
      onClick={() => setLocale(lang)}
    >
      {label}
    </button>
  );

  return (
    <div className="help-lang-toggle" role="group" aria-label={ui.languageLabel}>
      {btn("en", ui.langEn)}
      {btn("he", ui.langHe)}
    </div>
  );
}

function HelpViewInner({ scrollToSection, onScrolledToSection, showBackToPlan, onBackToPlan }: HelpViewProps) {
  const mainRef = useRef<HTMLElement>(null);
  const { locale, dir } = useHelpLocale();
  const ui = helpUi(locale);

  useEffect(() => {
    if (!scrollToSection) return;
    const id = scrollToSection.startsWith("#") ? scrollToSection.slice(1) : scrollToSection;
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      onScrolledToSection?.();
    }
  }, [scrollToSection, onScrolledToSection]);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="help-layout" dir={dir} lang={locale}>
      <nav className="help-nav glass-card" aria-label={ui.navAria}>
        <p className="help-nav-title">{ui.contents}</p>
        <HelpLanguageToggle />
        <ul className="help-nav-list">
          {GUIDE_SECTIONS.map(({ id }) => (
            <li key={id}>
              <button type="button" className="help-nav-link" onClick={() => scrollTo(id)}>
                {ui.sectionTitles[id as HelpSectionId]}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <main ref={mainRef} className="help-main">
        <header className="help-header glass-card">
          {showBackToPlan && onBackToPlan ? (
            <button
              type="button"
              className="btn btn-tinted btn-compact help-back-btn"
              onClick={onBackToPlan}
              title={ui.backToPlan}
            >
              <ArrowLeft size={16} aria-hidden />
              {ui.backToPlan}
            </button>
          ) : null}
          <div className="help-header-row">
            <div className="help-header-text">
              <h2 className="contacts-title" style={{ margin: 0 }}>
                {ui.pageTitle}
              </h2>
              <p className="contacts-hint" style={{ margin: "0.35rem 0 0" }}>
                {ui.pageSubtitle}
              </p>
            </div>
            <HelpLanguageToggle />
          </div>
        </header>

        {GUIDE_SECTIONS.map(({ id, Component }) => (
          <section key={id} id={id} className="help-section glass-card">
            <h3 className="help-section-title">{ui.sectionTitles[id as HelpSectionId]}</h3>
            <div className="help-section-body">
              <Component />
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}

export function HelpView(props: HelpViewProps) {
  return (
    <HelpLocaleProvider>
      <HelpViewInner {...props} />
    </HelpLocaleProvider>
  );
}

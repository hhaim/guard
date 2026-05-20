import { useEffect, useRef } from "react";
import { GUIDE_SECTIONS } from "../content/userGuide";

type HelpViewProps = {
  scrollToSection?: string | null;
  onScrolledToSection?: () => void;
};

export function HelpView({ scrollToSection, onScrolledToSection }: HelpViewProps) {
  const mainRef = useRef<HTMLElement>(null);

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
    <div className="help-layout">
      <nav className="help-nav glass-card" aria-label="Help sections">
        <p className="help-nav-title">Contents</p>
        <ul className="help-nav-list">
          {GUIDE_SECTIONS.map(({ id, title }) => (
            <li key={id}>
              <button type="button" className="help-nav-link" onClick={() => scrollTo(id)}>
                {title}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <main ref={mainRef} className="help-main">
        <header className="help-header glass-card">
          <h2 className="contacts-title" style={{ margin: 0 }}>
            Help
          </h2>
          <p className="contacts-hint" style={{ margin: "0.35rem 0 0" }}>
            In-app guide for soldiers, zones, planning, and stats. Describes current Plan simulator behavior (
            <code>hybrid_rel</code>).
          </p>
        </header>

        {GUIDE_SECTIONS.map(({ id, title, Component }) => (
          <section key={id} id={id} className="help-section glass-card">
            <h3 className="help-section-title">{title}</h3>
            <div className="help-section-body">
              <Component />
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}

export function GettingStartedEn() {
  return (
    <>
      <p>
        Guard scheduler helps you configure a roster and zone layout, generate draft duty proposals, apply one to the
        verified schedule, and review historical fairness in Stats.
      </p>
      <p>
        Work through the sections in order the first time: <strong>Soldiers</strong> → <strong>Slots & patterns</strong>{" "}
        → optional <strong>Tutorial 12×4</strong> → <strong>Plan workflow</strong> → <strong>Stats</strong> after Apply.
        Use <strong>Fairness & constraints</strong> when you need to understand why the simulator picks someone or
        rejects a setup.
      </p>
      <p className="contacts-hint">
        Admin users can edit soldiers, slots, time zones, global settings, and plans. Read-only users can open Plan and
        Stats (and this Help tab) but cannot save configuration or apply schedules.
      </p>
    </>
  );
}

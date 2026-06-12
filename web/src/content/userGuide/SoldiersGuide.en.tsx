export function SoldiersGuideEn() {
  return (
    <>
      <ol>
        <li>
          On the <strong>Soldiers</strong> tab, open <strong>Soldier types</strong> and add codes with labels (e.g.{" "}
          <code>A</code> → <code>Private_1</code>). Types save automatically after a short pause.
        </li>
        <li>
          Open <strong>Soldier platoons</strong> and add platoon codes with labels (e.g. <code>1</code> →{" "}
          <code>chod</code>). Platoons save the same way. A platoon assigned to any soldier cannot be deleted until
          that assignment is cleared.
        </li>
        <li>
          Tap <strong>Add</strong> on the roster and fill <strong>Full name</strong>, <strong>ID</strong>, optional{" "}
          <strong>Type</strong>, and optional <strong>Platoon</strong>. Roster rows are identity only (no per-soldier
          state field).
        </li>
        <li>
          Use the <strong>Status board</strong> to record away, sick, training, outings, and returns. Scheduling reads
          the status timeline (not inline roster state).
        </li>
        <li>
          Plan-day boundaries follow <strong>global plan day start</strong> (default 05:00). “Away this plan day” and
          outings use that window.
        </li>
        <li>
          Roster edits (name, ID, type, platoon, add/remove) save automatically after a short pause. Status rows save
          immediately when you tap a cell on the board.
        </li>
        <li>
          Use the roster search box to find soldiers by name, ID, type code/label, or platoon code/label. Use the
          filter icons on the <strong>Type</strong> and <strong>Platoon</strong> columns for Excel-style multi-select
          filters.
        </li>
        <li>
          Use <strong>Import / Export YAML</strong> for a single file with <code>soldier_types</code>,{" "}
          <code>soldier_platoons</code>, <code>soldiers</code> (including <code>platoon_code</code>), and{" "}
          <code>soldier_status</code>. Status import applies immediately for the file’s date range; types, platoons,
          and roster still autosave to cfg. <strong>Import / Export JSON</strong> is soldiers-only.
        </li>
        <li>
          Set per-platoon badge colors under <strong>Global</strong> → <strong>Platoon colors</strong>; they appear on
          the roster and in plan schedule tables.
        </li>
        <li>
          Hot status entries can be edited or deleted for about <strong>7 days</strong> after creation; older rows are
          read-only (append a correction instead).
        </li>
        <li>Double-click a roster row or use the chevron to edit; delete when the UI allows it.</li>
      </ol>
      <p className="contacts-hint">
        <strong>IDs matter:</strong> the simulator orders soldiers by roster position (index), but labels and exports
        use your ID strings (<code>s0</code>, <code>s12</code>, etc.). Multi-digit IDs are supported; schedule badges
        show the ID, not a single-digit <code>Sx</code> index. <strong>Type codes</strong> drive{" "}
        <code>full_day_team</code> minimum quotas in zones (e.g. <code>type_quotas: {"{B: 2}"}</code>); the simulator
        matches roster <code>type_code</code> to those minimums before filling generic team seats.{" "}
        <strong>Platoon codes</strong> group soldiers for display and colors, and drive{" "}
        <code>full_day_team</code> posts with <code>pin_platoon</code> (all team members on that post/day share one
        platoon — see Help → Slots &amp; patterns).
      </p>
    </>
  );
}

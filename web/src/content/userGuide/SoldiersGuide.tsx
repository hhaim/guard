export function SoldiersGuide() {
  return (
    <>
      <ol>
        <li>
          On the <strong>Soldiers</strong> tab, tap <strong>Add</strong> and fill <strong>ID</strong> and{" "}
          <strong>Full name</strong>. Roster rows are identity only (no per-soldier state field).
        </li>
        <li>
          Use the <strong>Status board</strong> below the roster to record away, sick, training, outings, and
          returns. Scheduling reads the status timeline (not inline roster state).
        </li>
        <li>
          Plan-day boundaries follow <strong>global plan day start</strong> (default 05:00). “Away this plan day”
          and outings use that window.
        </li>
        <li>
          Roster edits (name, ID, add/remove) save automatically after a short pause. Status rows save immediately
          when you tap a cell on the board.
        </li>
        <li>
          Use <strong>Import / Export JSON</strong> for bulk roster edits (same shape as the developer JSON panel).
        </li>
        <li>
          Hot status entries can be edited or deleted for about <strong>7 days</strong> after creation; older rows
          are read-only (append a correction instead).
        </li>
        <li>Double-click a roster row or use the chevron to edit; delete when the UI allows it.</li>
      </ol>
      <p className="contacts-hint">
        <strong>IDs matter:</strong> the simulator orders soldiers by roster position (index), but labels and exports
        use your ID strings (<code>s0</code>, <code>s12</code>, etc.). Multi-digit IDs are supported; schedule badges
        show the ID, not a single-digit <code>Sx</code> index.
      </p>
    </>
  );
}

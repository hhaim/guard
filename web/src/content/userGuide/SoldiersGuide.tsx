export function SoldiersGuide() {
  return (
    <>
      <ol>
        <li>
          On the <strong>Soldiers</strong> tab, tap <strong>Add</strong> and fill <strong>ID</strong>,{" "}
          <strong>Full name</strong>, and <strong>State</strong>.
        </li>
        <li>
          Only soldiers with state <strong>On base</strong> (<code>base</code>) are included in scheduling, Plan reports,
          and Stats. Leave, training, sick, and other states are excluded from the simulator and block charts.
        </li>
        <li>
          Tap <strong>Save soldiers</strong> to persist via <code>PUT /api/cfg/soldiers</code> (versioned).{" "}
          <strong>Discard</strong> reverts unsaved edits.
        </li>
        <li>
          Use <strong>Import / Export JSON</strong> for bulk roster edits (same shape as the developer JSON panel).
        </li>
        <li>Double-click a row or use the chevron to edit; delete when the UI allows it.</li>
      </ol>
      <p className="contacts-hint">
        <strong>IDs matter:</strong> the simulator orders soldiers by roster index. Stable IDs such as <code>s0</code>…
        <code>s11</code> make manual swaps, exports, and cross-checking proposals easier.
      </p>
    </>
  );
}

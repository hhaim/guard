export function Tutorial12x4() {
  return (
    <>
      <p>
        This walkthrough reproduces a minimal rotating setup: <strong>12 soldiers</strong>, <strong>4 concurrent
        slots</strong>, <strong>4-hour</strong> blocks (6 blocks per day). Expect <strong>24 assignments</strong> for one
        day (6 × 4).
      </p>

      <h3 className="help-subtitle">Setup</h3>
      <ol>
        <li>
          <strong>Soldiers:</strong> 12 entries, all <strong>On base</strong>. Suggested IDs: <code>s0</code>…
          <code>s11</code>. Save soldiers.
        </li>
        <li>
          <strong>Slots / zones:</strong> <code>shift_hours = 4</code>; one slot type with pattern{" "}
          <strong>rotating</strong>; one location (e.g. <code>loc_gate</code>); slots <code>g1</code>–<code>g4</code> pointing
          at that location. Save slots.
        </li>
        <li>
          <strong>Time zones:</strong> keep defaults or simple day/night bands. Save time zones.
        </li>
        <li>
          <strong>Global:</strong> note the planning anchor and optional debug day offset if you use them.
        </li>
        <li>
          <strong>Plan:</strong> <strong>1</strong> day, proposal slot <strong>01</strong>. Open simulation settings, for
          example:
          <ul>
            <li>Min free shifts after duty: 2</li>
            <li>Min consecutive free hours: 6</li>
            <li>Band relative: 0.2</li>
            <li>Optional seed for reproducibility</li>
          </ul>
          Tap <strong>Generate new</strong>.
        </li>
      </ol>

      <h3 className="help-subtitle">Reading the solution (Plan report)</h3>
      <ul>
        <li>
          <strong>Matrix (short / full):</strong> rows = time blocks, columns = slots; cell = assigned soldier; green =
          off duty, red = on duty.
        </li>
        <li>
          <strong>By soldier:</strong> block timeline per person.
        </li>
        <li>
          <strong>Timeline:</strong> lane view across slots.
        </li>
        <li>
          <strong>Statistics panel:</strong> fairness score (lower = fairer), per-location and per-time-band means,
          free-block stats.
        </li>
        <li>
          <strong>Manual swaps:</strong> change soldier on a row → <strong>Apply swap</strong> → <strong>Save
          proposal</strong> before Apply.
        </li>
        <li>
          <strong>PDF / Excel / Copy JSON:</strong> export for review (Excel is matrix only); does not publish the schedule.
        </li>
      </ul>

      <p className="contacts-hint">
        A proposal is a <strong>draft</strong> until you <strong>Apply</strong> it (see Plan workflow). Stats only reflect
        applied duties.
      </p>
    </>
  );
}

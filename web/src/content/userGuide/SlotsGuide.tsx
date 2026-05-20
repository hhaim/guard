export function SlotsGuide() {
  return (
    <>
      <p>Configure zones in dependency order (as hinted on the Slots tab):</p>
      <pre className="help-pre">
        {`Shift hours (2 / 3 / 4 h blocks)
  → Slot types (pattern)
    → Zone locations (type + weight)
      → Slots (concurrent posts → location_id)`}
      </pre>
      <p>
        The <strong>Time zones</strong> tab defines fairness bands (<code>from_hour</code>–<code>to_hour</code>,{" "}
        <strong>weight</strong>). Both Slots and Time zones save into the same zones document (
        <code>PUT /api/cfg/slots</code>).
      </p>

      <h3 className="help-subtitle">Pattern comparison</h3>
      <table className="help-table">
        <thead>
          <tr>
            <th>Pattern</th>
            <th>UI fields (slot type editor)</th>
            <th>Scheduling behavior</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>rotating</strong>
            </td>
            <td>Pattern only</td>
            <td>Fills each calendar block; one soldier per slot row per block</td>
          </tr>
          <tr>
            <td>
              <strong>full_day</strong>
            </td>
            <td>
              <code>start</code>, <code>end</code>, <code>rest_after_hours</code>, <code>weight_multiplier</code>
            </td>
            <td>One soldier per day for the duty window; marks busy through rest</td>
          </tr>
          <tr>
            <td>
              <strong>windowed_slots</strong>
            </td>
            <td>
              Window list (<code>start</code>/<code>end</code>, multipliers), <code>rest_after_hours</code>,{" "}
              <code>full_day_shift</code>
            </td>
            <td>One soldier per day; picks the best window for that post</td>
          </tr>
        </tbody>
      </table>

      <h3 className="help-subtitle">Examples in the UI (no import required)</h3>
      <ul>
        <li>
          <strong>Rotating-only (tutorial):</strong> one type <code>rotating_slot</code>, location <code>loc_gate</code>,
          four slots <code>g1</code>–<code>g4</code> (same idea as the sample <code>zones_s1.yaml</code> slots block).
        </li>
        <li>
          <strong>Full day:</strong> kitchen post 06:00–22:00 with 6 h rest — mirror <code>full_day_kitchen</code> fields
          from mixed-pattern samples.
        </li>
        <li>
          <strong>Windowed:</strong> two windows in one day — <code>windowed_hamal</code> style (e.g. 00:00–12:00 and
          12:00–24:00 with different multipliers).
        </li>
        <li>
          <strong>Mixed roster:</strong> define several locations under zone locations, but only locations referenced in
          the <strong>Slots</strong> list are scheduled concurrently.
        </li>
      </ul>

      <p>
        <strong>Fill order</strong> in the simulator: full_day → windowed_slots → rotating (rotating fills remaining
        blocks).
      </p>
      <p className="contacts-hint">
        Use <strong>Save slots</strong> on the Slots tab and <strong>Save time zones</strong> on the Time zones tab before
        generating a plan.
      </p>
    </>
  );
}

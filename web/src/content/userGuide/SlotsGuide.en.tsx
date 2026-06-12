export function SlotsGuideEn() {
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

      <h3 className="help-subtitle">Web UI → YAML (document and shared fields)</h3>
      <p>
        The Slots tab forms map directly to the zones YAML/JSON document. Pattern-specific settings live under{" "}
        <code>slots_types[].config</code> except where noted.
      </p>
      <table className="help-table">
        <thead>
          <tr>
            <th>Where in UI</th>
            <th>YAML key</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>Shift hours</strong> (top of Slots tab)
            </td>
            <td>
              <code>shift_hours</code>
            </td>
            <td>2, 3, or 4 — calendar block size for rotating fill</td>
          </tr>
          <tr>
            <td>
              Slot type — <strong>Name</strong>, <strong>ID</strong>, <strong>Pattern</strong>
            </td>
            <td>
              <code>name</code>, <code>id</code>, <code>pattern</code>
            </td>
            <td>On each <code>slots_types</code> row</td>
          </tr>
          <tr>
            <td>
              Slot type — <strong>Off on (weekdays)</strong>
            </td>
            <td>
              <code>disabled_weekdays</code>
            </td>
            <td>
              e.g. <code>[friday, saturday]</code> — all patterns; weekday at plan day start
            </td>
          </tr>
          <tr>
            <td>
              Slot type — <strong>Excluded soldier types</strong>
            </td>
            <td>
              <code>exclude</code>
            </td>
            <td>
              e.g. <code>[A, B]</code> — all patterns; requires roster <code>type_code</code>
            </td>
          </tr>
          <tr>
            <td>
              Zone location — names, ID, type, <strong>Weight</strong>
            </td>
            <td>
              <code>zone_loc[]</code>
            </td>
            <td>
              <code>weight</code> affects fairness for locations of this type
            </td>
          </tr>
          <tr>
            <td>
              Slot row — location, names, <strong>Disabled</strong>
            </td>
            <td>
              <code>slots[]</code>
            </td>
            <td>
              <code>location_id</code>, <code>name</code>, <code>full_name</code>, optional <code>disabled: true</code>
            </td>
          </tr>
          <tr>
            <td>
              Slot row — <strong>Soldiers required</strong>
            </td>
            <td>
              <code>soldiers_required</code>
            </td>
            <td>
              <strong>rotating</strong> locations only; default <code>1</code>
            </td>
          </tr>
        </tbody>
      </table>

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
            <td>
              Pattern only (plus shared <code>disabled_weekdays</code>, <code>exclude</code>)
            </td>
            <td>Fills each calendar block; one soldier per slot row per block</td>
          </tr>
          <tr>
            <td>
              <strong>full_day</strong>
            </td>
            <td>
              <code>config</code>: start, end, rest, weight, headcount; optional{" "}
              <code>disabled_weekdays</code> (no <code>type_quotas</code>)
            </td>
            <td>
              <code>headcount</code> soldiers per day on each slot row for this type; marks busy through rest
            </td>
          </tr>
          <tr>
            <td>
              <strong>full_day_team</strong>
            </td>
            <td>
              Same as full_day <code>config</code>, plus <code>hours_factor</code>, <code>type_quotas</code>, optional{" "}
              <strong>Pin platoon</strong> (<code>pin_platoon</code>)
            </td>
            <td>
              Fills typed minimums first (largest quota first), then generic seats; with{" "}
              <code>pin_platoon</code>, prefers one platoon per day and may mix platoons only when a quota cannot be met
              inside the preferred platoon; matrix lists all names in the cell
            </td>
          </tr>
          <tr>
            <td>
              <strong>windowed_slots</strong>
            </td>
            <td>
              Type-level <code>rest_after_hours</code>, <code>full_day_shift</code>; <code>config</code> windows +{" "}
              <code>headcount</code>
            </td>
            <td>
              <code>headcount</code> soldiers per day after the best window is chosen; optional{" "}
              <code>disabled_weekdays</code>
            </td>
          </tr>
        </tbody>
      </table>
      <p className="contacts-hint">
        <strong>Excluded soldier types</strong> (<code>exclude</code>) applies to every pattern: checked type codes
        cannot fill any slot whose zone location uses that slot type.
      </p>

      <h3 className="help-subtitle">rotating</h3>
      <p>No <code>config</code> block in the slot type editor. Set concurrent posts per row under <strong>Slots</strong>{" "}
      with <code>soldiers_required</code> (default 1).</p>

      <h3 className="help-subtitle">full_day</h3>
      <table className="help-table">
        <thead>
          <tr>
            <th>UI label</th>
            <th>YAML (<code>config</code>)</th>
            <th>Behavior</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Start / End</td>
            <td>
              <code>start</code>, <code>end</code>
            </td>
            <td>Wall-clock duty span (<code>HH:00</code>)</td>
          </tr>
          <tr>
            <td>Rest after (hours)</td>
            <td>
              <code>rest_after_hours</code>
            </td>
            <td>Busy period after duty ends</td>
          </tr>
          <tr>
            <td>Weight multiplier</td>
            <td>
              <code>weight_multiplier</code>
            </td>
            <td>Fairness weight for this post</td>
          </tr>
          <tr>
            <td>Hours factor</td>
            <td>
              <code>hours_factor</code>
            </td>
            <td>Credited duty fraction for fairness (default 1); busy span unchanged</td>
          </tr>
          <tr>
            <td>Headcount</td>
            <td>
              <code>headcount</code>
            </td>
            <td>Soldiers assigned per day per slot row</td>
          </tr>
        </tbody>
      </table>

      <h3 className="help-subtitle">full_day_team</h3>
      <p>Includes all <strong>full_day</strong> <code>config</code> fields (including <code>hours_factor</code>), plus:</p>
      <table className="help-table">
        <thead>
          <tr>
            <th>UI label</th>
            <th>YAML (<code>config</code>)</th>
            <th>Behavior</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Type quotas (minimums)</td>
            <td>
              <code>type_quotas</code>
            </td>
            <td>
              e.g. <code>{"{A: 1, E: 3}"}</code> — minimum per <code>type_code</code>; sum ≤ headcount
            </td>
          </tr>
          <tr>
            <td>Pin platoon (prefer one platoon per team shift)</td>
            <td>
              <code>pin_platoon: true</code>
            </td>
            <td>
              Optimistic pinning: tries one <code>platoon_code</code> per day (by fitness), then per-seat fallback to
              other platoons if a quota cannot be filled inside it. Single-seat quotas (e.g. <code>H: 1</code>) steer
              rotation even when roster counts differ per platoon. <code>type_quotas</code> stay hard. Requires roster
              platoon on soldiers.
            </td>
          </tr>
        </tbody>
      </table>
      <p className="contacts-hint">
        YAML import may use <code>features: [pin_platoon]</code> instead of the boolean; the UI checkbox writes{" "}
        <code>pin_platoon: true</code>.
      </p>
      <pre className="help-pre">
        {`- id: team
  pattern: full_day_team
  config:
    start: "09:00"
    end: "17:00"
    rest_after_hours: 6
    weight_multiplier: 1
    headcount: 8
    hours_factor: 0.33
    type_quotas: { A: 1, E: 3 }
    pin_platoon: true`}
      </pre>

      <h3 className="help-subtitle">windowed_slots</h3>
      <table className="help-table">
        <thead>
          <tr>
            <th>UI label</th>
            <th>YAML</th>
            <th>Behavior</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Rest after (hours)</td>
            <td>
              <code>rest_after_hours</code> (on slot type)
            </td>
            <td>Not inside <code>config</code></td>
          </tr>
          <tr>
            <td>Full day shift</td>
            <td>
              <code>full_day_shift</code> (on slot type)
            </td>
            <td>Shift index for full-day window selection</td>
          </tr>
          <tr>
            <td>Headcount</td>
            <td>
              <code>config.headcount</code>
            </td>
            <td>Soldiers per day after best window is chosen</td>
          </tr>
          <tr>
            <td>Windows — name, start, end, weight</td>
            <td>
              <code>config.slots[]</code>
            </td>
            <td>Each window: <code>name</code>, <code>start</code>, <code>end</code>, <code>weight_multiplier</code></td>
          </tr>
        </tbody>
      </table>

      <p>
        <strong>Off on weekdays:</strong> on each slot type, check days under “Off on” to set{" "}
        <code>disabled_weekdays</code> (e.g. <code>friday</code>, <code>saturday</code>). The weekday is taken at{" "}
        <strong>plan day start</strong> (global <code>plan_day_start</code>, default 05:00), so a duty that runs
        05:00→next 05:00 uses the first day&apos;s weekday, not the calendar date after midnight.
      </p>
      <p>
        <strong>Disabled slot:</strong> on each slot row, check <strong>Disabled</strong> to set{" "}
        <code>disabled: true</code>. The slot stays in the config (saved to the database) but is excluded from
        scheduling and plan generation. Disabled rows appear muted in the Slots table. At least one slot must remain
        active.
      </p>
      <p>
        <strong>Soldiers required:</strong> on each slot row for <code>rotating</code> only.{" "}
        <code>full_day</code>, <code>full_day_team</code>, and <code>windowed_slots</code> use <code>headcount</code> on
        the slot type. Default <code>1</code>.
      </p>

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
          <strong>Pin platoon team post:</strong> <code>full_day_team</code> with <strong>Pin platoon</strong> checked
          (one platoon when possible; cross-platoon only for missing quota seats); assign <strong>Platoon</strong> on the
          roster (Soldiers tab). See YAML example above.
        </li>
        <li>
          <strong>Mixed roster:</strong> define several locations under zone locations, but only locations referenced in
          the <strong>Slots</strong> list are scheduled concurrently.
        </li>
      </ul>

      <p>
        <strong>Fill order</strong> in the simulator: full_day_team → full_day → windowed_slots → rotating (rotating
        fills remaining blocks).
      </p>
      <p className="contacts-hint">
        <strong>Wall-clock times</strong> for full day and windowed patterns must be whole hours (<code>HH:00</code>;
        <code>24:00</code> allowed for window ends). The Slots tab JSON editor and slot-type form validate before autosave
        so simulation and plan generation do not fail.
      </p>
      <p className="contacts-hint">
        Slots and Time zones edits save automatically to the same zones document (<code>PUT /api/cfg/slots</code>).
      </p>
    </>
  );
}

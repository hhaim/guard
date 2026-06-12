export function ExpertRulesGuideEn() {
  return (
    <>
      <p>
        Expert rules run <strong>inside the simulator</strong> before soldiers are picked. They override soft fairness
        behavior but not hard zone YAML excludes. They are not the same as manual swaps after generate.
      </p>

      <h3 className="help-subtitle">Reading IDs from the matrix</h3>
      <ul>
        <li>
          <code>day</code> — 0-based plan day (matrix heading <code>Day 0  Saturday, …</code>)
        </li>
        <li>
          <code>slot</code> — 1-based slot id (column header <code>Slot 3 · …</code>)
        </li>
        <li>
          <code>shift</code> — 0-based block index (row label <code>05:00–09:00(0)</code>)
        </li>
        <li>Omit <code>shift</code> for full_day, full_day_team, and whole-slot rules</li>
        <li>
          Omit <code>day</code>, <code>slot</code>, or <code>shift</code> on <code>not</code> / <code>exclude</code> to
          mean <strong>all</strong> plan days, slots, or shifts (see wildcard examples below)
        </li>
      </ul>

      <h3 className="help-subtitle">Examples</h3>
      <p>One line = one rule. Copy <code>day</code>, <code>slot</code>, and <code>shift</code> from the matrix tooltip.</p>
      <table className="help-table">
        <thead>
          <tr>
            <th>Example</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>exclude:s34</code>
            </td>
            <td>
              Mark <code>s34</code> away for this plan — no assignments on any day, slot, or shift. Plan-only; does not
              change Soldiers status.
            </td>
          </tr>
          <tr>
            <td>
              <code>exclude:s34 day:0</code>
            </td>
            <td>
              Same as above but only on plan day 0. Omit <code>day</code> to apply to every planning day.
            </td>
          </tr>
          <tr>
            <td>
              <code>not:s3,s1 shift:0</code>
            </td>
            <td>
              Exclude <code>s3</code> and <code>s1</code> from shift 0 in <strong>every slot</strong> (omit{" "}
              <code>slot</code>). Affects rotating per-block picks; whole-slot patterns use shift -1 and are unaffected
              unless you omit <code>shift</code> too.
            </td>
          </tr>
          <tr>
            <td>
              <code>day:0 slot:1 shift:0 not:s1</code>
            </td>
            <td>
              On plan day 0, soldier <code>s1</code> cannot be assigned to slot 1, shift 0. Everyone else stays eligible
              for that seat.
            </td>
          </tr>
          <tr>
            <td>
              <code>day:0 slot:1 shift:2 force:s42</code>
            </td>
            <td>
              On day 0, try to put <code>s42</code> in slot 1, shift 2. With Force <strong>off</strong> (prefer), the
              simulator uses <code>s42</code> only if rest and availability allow; otherwise it picks fairly among others.
              With Force <strong>on</strong>, <code>s42</code> is assigned anyway and any override is listed under rule
              conflicts.
            </td>
          </tr>
          <tr>
            <td>
              <code>slot:2 shift:1 not:s1,s2,s3</code>
            </td>
            <td>
              On <strong>every</strong> plan day (no <code>day</code> field), exclude <code>s1</code>, <code>s2</code>,
              and <code>s3</code> from slot 2, shift 1.
            </td>
          </tr>
          <tr>
            <td>
              <code>day:0 slot:6 shift:4 force_type:H</code>
            </td>
            <td>
              On day 0, only soldiers whose roster type is <code>H</code> may fill slot 6, shift 4. Works on rotating,
              windowed, and similar per-block slots — not on full_day_team.
            </td>
          </tr>
          <tr>
            <td>
              <code>day:0 slot:10 force_type:E</code>
            </td>
            <td>
              On day 0, the whole full_day slot 10 must be filled from soldiers with type <code>E</code>. Omit{" "}
              <code>shift</code> because full_day covers the entire slot for that day.
            </td>
          </tr>
          <tr>
            <td>
              <code>day:0 slot:8 pin:3</code>
            </td>
            <td>
              On day 0, full_day_team slot 8 is filled only from platoon <code>3</code>, overriding the slot’s default{" "}
              <code>pin_platoon</code> behavior in zones YAML.
            </td>
          </tr>
          <tr>
            <td>
              <code>day:0 slot:8 type_remap G&gt;H:2</code>
            </td>
            <td>
              On day 0, before filling full_day_team slot 8, move 2 seats from the <code>G</code> type quota to the{" "}
              <code>H</code> quota (<code>G&gt;H:2</code>). Only valid on full_day_team slots.
            </td>
          </tr>
        </tbody>
      </table>

      <h3 className="help-subtitle">Force checkbox</h3>
      <table className="help-table">
        <thead>
          <tr>
            <th>Mode</th>
            <th>Behavior for <code>force</code></th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Unchecked (prefer)</td>
            <td>Use named soldier if eligible; otherwise fairness fallback</td>
          </tr>
          <tr>
            <td>Checked (hard)</td>
            <td>
              Assign anyway unless blocked by <code>not</code> / <code>exclude</code>; list conflicts after generate
            </td>
          </tr>
        </tbody>
      </table>

      <h3 className="help-subtitle">Operations</h3>
      <ul>
        <li>
          <code>force</code> — assign soldier (respects Force checkbox)
        </li>
        <li>
          <code>not</code> — exclude soldiers from the pool (optional wildcards for day / slot / shift)
        </li>
        <li>
          <code>exclude</code> — global away for this plan (<code>exclude:s34</code> = all days, slots, shifts)
        </li>
        <li>
          <code>pin</code> — full_day_team platoon override
        </li>
        <li>
          <code>force_type</code> — require type on rotating / windowed / full_day
        </li>
        <li>
          <code>type_remap</code> — full_day_team quota remap (<code>G&gt;H:2</code>)
        </li>
      </ul>
    </>
  );
}

export function PlanWorkflowGuideEn() {
  return (
    <>
      <p>
        Up to four draft proposals exist for the planning anchor day. One can be applied to the verified schedule. The
        run uses <code>anchor_date</code> (YYYY-MM-DD): plan day 0 is that calendar date, and slot types with{" "}
        <code>disabled_weekdays</code> are skipped on matching weekdays (e.g. no Friday kitchen team when Friday is
        checked “Off on” in Slots).
      </p>

      <ol>
        <li>
          <strong>Choose proposal</strong> — slot 01–04 (filled slots show assignment counts).
        </li>
        <li>
          <strong>Generate new / Regenerate</strong> — runs the simulator; overwrites only the selected slot (admin).
        </li>
        <li>
          Review matrix, stats, and optional <strong>manual swaps</strong> in the change table.
        </li>
        <li>
          <strong>Save proposal</strong> — persists the draft and manual edits.
        </li>
        <li>
          <strong>Apply to verified schedule</strong> — confirms, writes one row per calendar day (insert-only; 409 if a day already exists), then{" "}
          <strong>clears all four proposal slots</strong>.
        </li>
      </ol>

      <table className="help-table">
        <thead>
          <tr>
            <th>Action</th>
            <th>Effect</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>Generate / Regenerate</strong>
            </td>
            <td>Overwrites the selected proposal slot only</td>
          </tr>
          <tr>
            <td>
              <strong>Save proposal</strong>
            </td>
            <td>Persists draft + manual edits</td>
          </tr>
          <tr>
            <td>
              <strong>Clear proposal</strong>
            </td>
            <td>Deletes one slot (not the verified schedule)</td>
          </tr>
          <tr>
            <td>
              <strong>Apply</strong>
            </td>
            <td>Writes verified duties; clears proposals 01–04</td>
          </tr>
        </tbody>
      </table>

      <p className="contacts-hint">
        <strong>Download Excel</strong> exports only the schedule matrix (full names, platoon colors) for the current
        proposal. Read-only users can view proposals, reports, PDF, Excel, and Stats but cannot generate, save, clear, or
        apply.
      </p>
    </>
  );
}

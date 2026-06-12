export function StatsGuideEn() {
  return (
    <>
      <p>
        The <strong>Stats</strong> tab shows the <strong>verified schedule</strong> only — duties stored after{" "}
        <strong>Apply</strong> on Plan — not draft proposal slots.
      </p>
      <ul>
        <li>
          <strong>End date</strong> and <strong>days back</strong> define the UTC date range.
        </li>
        <li>
          <strong>Block-count bar chart:</strong> duty blocks per soldier over the range.
        </li>
        <li>Optional <strong>day matrix</strong> toggle for a per-day grid.</li>
        <li>
          Reuses the same <strong>schedule report</strong> and <strong>statistics panel</strong> as Plan for fairness
          charts on historical data.
        </li>
        <li>
          <strong>Export YAML</strong> downloads the applied schedule for the selected range.
        </li>
        <li>
          With <strong>Show schedule matrix</strong> on, <strong>Download Excel</strong> exports only that matrix (full
          names, platoon cell colors) for the selected verified day.
        </li>
        <li>
          <strong>Remove verified day (admin):</strong> deletes one calendar day from history (with a confirmation
          dialog) so you can re-apply a plan for that date.
        </li>
      </ul>
      <p className="contacts-hint">If nothing appears, apply a plan first — empty state means no verified rows in range.</p>

      <table className="help-table">
        <thead>
          <tr>
            <th>Tab</th>
            <th>Data source</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>Plan</strong>
            </td>
            <td>Draft proposals (slots 01–04); edits until Apply</td>
          </tr>
          <tr>
            <td>
              <strong>Stats</strong>
            </td>
            <td>Production history in the database after Apply</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

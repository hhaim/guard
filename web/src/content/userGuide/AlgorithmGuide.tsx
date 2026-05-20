export function AlgorithmGuide() {
  return (
    <>
      <p>
        The Plan tab runs the <code>guardsched</code> mixed-pattern simulator (<code>hybrid_rel</code> selection). Hard
        rules decide who is eligible; soft rules pick among eligible soldiers.
      </p>

      <h3 className="help-subtitle">Hard constraints (eligibility)</h3>
      <p>Applied before picking a soldier for each rotating block (in order):</p>
      <ol>
        <li>Not already assigned in this block</li>
        <li>
          Rest arc from <strong>min consecutive free hours</strong> (unless cooldown mode disables the per-soldier rest
          grid when all slots are rotating and cooldown hours cover the rest requirement)
        </li>
        <li>Busy from full_day, windowed_slots, or prior rotating duty in the run</li>
        <li>
          <strong>Max consecutive duty blocks</strong> (if configured)
        </li>
        <li>
          <strong>Min free shifts after duty</strong> — cooldown: enough free rotating blocks since last rotating duty
        </li>
        <li>
          Optional DFS mask when the setup is rotating-only with a small search space (finds a feasible prefix before
          greedy fill)
        </li>
      </ol>
      <p>After the schedule is built, validators check rest feasibility and max consecutive duty.</p>

      <h3 className="help-subtitle">Soft selection (fairness)</h3>
      <ul>
        <li>
          Each assignment adds <strong>weight</strong> = shift hours × location weight × time-zone weight × pattern
          multiplier.
        </li>
        <li>Per soldier, scores are normalized by available hours in the planning run.</li>
        <li>
          Pick order: optional <strong>evening-preference / gap</strong> prefix when cooldown is enabled → then location
          owed → global → time band → mean time → total raw hours → soldier index (lexicographic tuple).
        </li>
        <li>
          <strong>Random band:</strong> keep soldiers within <code>(1 + band_relative)</code> of the best location
          score, then the same for time band, optional total-hours balance, then random among survivors.
        </li>
      </ul>

      <h3 className="help-subtitle">Simulation settings (Plan panel)</h3>
      <ul>
        <li>
          <strong>Min free shifts after duty</strong> — tightening increases gaps between rotating duties; too strict can
          make generation fail.
        </li>
        <li>
          <strong>Min consecutive free hours</strong> — requires longer off-duty stretches (converted to block counts).
        </li>
        <li>
          <strong>Band relative</strong> — wider band = more randomness among near-fair candidates; narrower = stricter
          fairness tie-break.
        </li>
      </ul>

      <p className="contacts-hint sched-hint">
        Future scoring may adopt lookback windows from the design v2 doc; the current Plan simulator uses full-run{" "}
        <code>hybrid_rel</code> keys as described above.
      </p>
    </>
  );
}

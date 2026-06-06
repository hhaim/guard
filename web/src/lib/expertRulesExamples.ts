/** Canonical expert-rule example lines (shared by Plan UI and Help). */
export const EXPERT_RULES_EXAMPLE_LINES = [
  "exclude:s34",
  "exclude:s34 day:0",
  "not:s3,s1 shift:0",
  "day:0 slot:1 shift:0 not:s1",
  "day:0 slot:1 shift:2 force:s42",
  "slot:2 shift:1 not:s1,s2,s3",
  "day:0 slot:6 shift:4 force_type:H",
  "day:0 slot:10 force_type:E",
  "day:0 slot:8 pin:3",
  "day:0 slot:8 type_remap G>H:2",
] as const;

export const EXPERT_RULES_EXAMPLE_TEXT = EXPERT_RULES_EXAMPLE_LINES.join("\n");

export type ExpertRuleExample = {
  line: string;
  title: string;
  help: string;
};

export const EXPERT_RULES_EXAMPLES: ExpertRuleExample[] = [
  {
    line: "exclude:s34",
    title: "Exclude soldier (all days)",
    help: "Mark s34 away for this plan — no assignments on any day, slot, or shift.",
  },
  {
    line: "exclude:s34 day:0",
    title: "Exclude on one day",
    help: "Same as global exclude but only on plan day 0.",
  },
  {
    line: "not:s3,s1 shift:0",
    title: "Not on every slot, shift 0",
    help: "Exclude s3 and s1 from shift 0 in every slot (omit slot).",
  },
  {
    line: "day:0 slot:1 shift:0 not:s1",
    title: "Not one seat",
    help: "On day 0, s1 cannot fill slot 1, shift 0.",
  },
  {
    line: "day:0 slot:1 shift:2 force:s42",
    title: "Force soldier",
    help: "Try to put s42 in slot 1, shift 2 (respects Force checkbox).",
  },
  {
    line: "slot:2 shift:1 not:s1,s2,s3",
    title: "Not every day",
    help: "On every plan day, exclude s1, s2, s3 from slot 2, shift 1.",
  },
  {
    line: "day:0 slot:6 shift:4 force_type:H",
    title: "Force type (per block)",
    help: "Only type H soldiers may fill slot 6, shift 4 on day 0.",
  },
  {
    line: "day:0 slot:10 force_type:E",
    title: "Force type (full day)",
    help: "Whole full_day slot 10 filled from type E on day 0.",
  },
  {
    line: "day:0 slot:8 pin:3",
    title: "Pin platoon",
    help: "full_day_team slot 8 filled only from platoon 3 on day 0.",
  },
  {
    line: "day:0 slot:8 type_remap G>H:2",
    title: "Type remap",
    help: "Move 2 seats from G quota to H quota before filling slot 8.",
  },
];

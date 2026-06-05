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

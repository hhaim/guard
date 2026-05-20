import type { ComponentType } from "react";
import { AlgorithmGuide } from "./AlgorithmGuide";
import { GettingStarted } from "./GettingStarted";
import { PlanWorkflowGuide } from "./PlanWorkflowGuide";
import { SlotsGuide } from "./SlotsGuide";
import { SoldiersGuide } from "./SoldiersGuide";
import { StatsGuide } from "./StatsGuide";
import { Tutorial12x4 } from "./Tutorial12x4";

export type GuideSection = {
  id: string;
  title: string;
  Component: ComponentType;
};

export const GUIDE_SECTIONS: GuideSection[] = [
  { id: "getting-started", title: "Getting started", Component: GettingStarted },
  { id: "soldiers", title: "Soldiers", Component: SoldiersGuide },
  { id: "slots", title: "Slots & patterns", Component: SlotsGuide },
  { id: "tutorial-12x4", title: "Tutorial 12×4", Component: Tutorial12x4 },
  { id: "plan-workflow", title: "Plan workflow", Component: PlanWorkflowGuide },
  { id: "stats", title: "Stats tab", Component: StatsGuide },
  { id: "algorithm", title: "Fairness & constraints", Component: AlgorithmGuide },
];

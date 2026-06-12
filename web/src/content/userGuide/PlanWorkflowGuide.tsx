import { PlanWorkflowGuideEn } from "./PlanWorkflowGuide.en";
import { PlanWorkflowGuideHe } from "./PlanWorkflowGuide.he";
import { LocalizedGuide } from "./localizedGuide";

export function PlanWorkflowGuide() {
  return <LocalizedGuide en={PlanWorkflowGuideEn} he={PlanWorkflowGuideHe} />;
}

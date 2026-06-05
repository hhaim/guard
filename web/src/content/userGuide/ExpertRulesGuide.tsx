import { ExpertRulesGuideEn } from "./ExpertRulesGuide.en";
import { ExpertRulesGuideHe } from "./ExpertRulesGuide.he";
import { LocalizedGuide } from "./localizedGuide";

export function ExpertRulesGuide() {
  return <LocalizedGuide en={ExpertRulesGuideEn} he={ExpertRulesGuideHe} />;
}

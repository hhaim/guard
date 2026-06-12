import { SoldiersGuideEn } from "./SoldiersGuide.en";
import { SoldiersGuideHe } from "./SoldiersGuide.he";
import { LocalizedGuide } from "./localizedGuide";

export function SoldiersGuide() {
  return <LocalizedGuide en={SoldiersGuideEn} he={SoldiersGuideHe} />;
}

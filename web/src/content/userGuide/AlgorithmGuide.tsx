import { AlgorithmGuideEn } from "./AlgorithmGuide.en";
import { AlgorithmGuideHe } from "./AlgorithmGuide.he";
import { LocalizedGuide } from "./localizedGuide";

export function AlgorithmGuide() {
  return <LocalizedGuide en={AlgorithmGuideEn} he={AlgorithmGuideHe} />;
}

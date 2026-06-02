import { SlotsGuideEn } from "./SlotsGuide.en";
import { SlotsGuideHe } from "./SlotsGuide.he";
import { LocalizedGuide } from "./localizedGuide";

export function SlotsGuide() {
  return <LocalizedGuide en={SlotsGuideEn} he={SlotsGuideHe} />;
}

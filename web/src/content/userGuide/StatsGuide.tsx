import { StatsGuideEn } from "./StatsGuide.en";
import { StatsGuideHe } from "./StatsGuide.he";
import { LocalizedGuide } from "./localizedGuide";

export function StatsGuide() {
  return <LocalizedGuide en={StatsGuideEn} he={StatsGuideHe} />;
}

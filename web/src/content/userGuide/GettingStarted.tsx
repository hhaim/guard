import { GettingStartedEn } from "./GettingStarted.en";
import { GettingStartedHe } from "./GettingStarted.he";
import { LocalizedGuide } from "./localizedGuide";

export function GettingStarted() {
  return <LocalizedGuide en={GettingStartedEn} he={GettingStartedHe} />;
}

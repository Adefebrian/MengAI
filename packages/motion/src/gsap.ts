// GSAP, registered once, with the JAL curve and token readers. Every GSAP
// plugin is free (since the 2024 Webflow licensing change), so SplitText and
// CustomEase ship from the public package.
import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

let registered = false;

/** True once the plugins are registered. Under reduced motion nothing
 *  registers, so no ScrollTrigger listener and no ticker ever starts. */
export function isRegistered(): boolean {
  return registered;
}

/** Register the plugins and the "jal-standard" ease. Safe to call often. */
export function registerMotion(): void {
  if (registered || typeof window === "undefined") return;
  gsap.registerPlugin(ScrollTrigger, SplitText, CustomEase);
  CustomEase.create("jal-standard", "0.24, 1, 0.4, 1");
  registered = true;
}

/** A duration token (ms in tokens.css) in seconds, for GSAP. */
export function tokSeconds(name: string, fallbackMs: number): number {
  if (typeof document === "undefined") return fallbackMs / 1000;
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return (Number.isFinite(v) && v > 0 ? v : fallbackMs) / 1000;
}

/** A spacing token in px. */
export function tokPx(name: string, fallback: number): number {
  if (typeof document === "undefined") return fallback;
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(v) ? v : fallback;
}

export { gsap, ScrollTrigger, SplitText, CustomEase };

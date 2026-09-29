// Kit preview, page B: /motion?d=D3 renders the office landing with the
// motion module (Lenis on the GSAP clock, KitMotion at tier 3).
import { createRoot } from "@kit-preview/react-dom-client";
import { DIRECTIONS } from "../Page";
import { bootDirection, landOnHash } from "./boot";
import { MotionLanding } from "./MotionLanding";

const direction = bootDirection("D3");
document.title = `Kit preview B, ${direction} ${DIRECTIONS[direction]}, motion module`;

const mount = document.getElementById("root");
if (mount) {
  createRoot(mount).render(<MotionLanding direction={direction} />);
  landOnHash();
}

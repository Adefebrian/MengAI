// Kit preview, page A: /landing?d=D1 renders the tidy product landing in one
// direction with the kit's own motion. Page B is /motion (motion-entry.tsx).
import { createRoot } from "@kit-preview/react-dom-client";
import { DIRECTIONS } from "../Page";
import { bootDirection, landOnHash } from "./boot";
import { Landing } from "./Landing";

const direction = bootDirection("D1");
document.title = `Kit preview A, ${direction} ${DIRECTIONS[direction]}`;

const mount = document.getElementById("root");
if (mount) {
  createRoot(mount).render(<Landing direction={direction} />);
  landOnHash();
}

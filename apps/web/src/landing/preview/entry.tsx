// Standalone landing preview entry (not shipped): renders <Landing /> alone
// so ui_audit and ui_shots can run while the rest of the web build moves.
// Preview only: ?kind=fund switches the lifecycle to the hedge fund and
// ?scene=<n> plays that lifecycle scene, so an audit can check any state.
import { createRoot } from "react-dom/client";
import { Landing } from "../index";
import "./preview.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root element not found");
createRoot(root).render(<Landing />);

const params = new URLSearchParams(location.search);
const kind = params.get("kind");
const scene = params.get("scene");
if (kind || scene) {
  setTimeout(() => {
    if (kind === "fund") document.querySelectorAll<HTMLButtonElement>("#company .lp-kind")[1]?.click();
    setTimeout(() => {
      if (scene !== null) document.querySelectorAll<HTMLButtonElement>("#company .lp-scene")[Number(scene)]?.click();
    }, 50);
  }, 50);
}

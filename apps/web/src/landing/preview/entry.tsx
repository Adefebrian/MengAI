// Standalone landing preview entry (not shipped): renders <Landing /> alone
// so ui_audit and ui_shots can run while the rest of the web build moves.
import { createRoot } from "react-dom/client";
import { Landing } from "../index";
import "./preview.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root element not found");
createRoot(root).render(<Landing />);

// Preview bundle entry: the preview's own layout CSS, then the page. The
// package marks only cats.css as a side effect, so the page boots through
// an explicit call rather than a bare import.
import "./preview.css";
import { start } from "./app";

start();

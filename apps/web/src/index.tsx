import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CONSOLE_CREDIT } from "./credit";
import { Root } from "./Root";
import "./styles.css";

// The credit and the license, once, for anyone who opens the console.
// eslint-disable-next-line no-console
console.info(CONSOLE_CREDIT);

const root = document.getElementById("root");
if (!root) throw new Error("#root element not found");

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

import { describe, expect, test } from "bun:test";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const EMDASH = "\u2014";

describe("<App />", () => {
  test("renders the welcome heading", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    root.render(<App />);
    // Let React flush the initial commit.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const heading = container.querySelector("h1");
    expect(heading).toBeTruthy();
    expect(heading?.textContent).toContain("Welcome to crew");

    root.unmount();
    container.remove();
  });

  test("renders inside the app-shell with 3 to 5 destinations", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    root.render(<App />);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.querySelector(".shell header")).toBeTruthy();
    const items = container.querySelectorAll(".shell nav a");
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items.length).toBeLessThanOrEqual(5);
    expect(container.querySelectorAll('.shell nav a[aria-current="page"]').length).toBe(1);

    root.unmount();
    container.remove();
  });

  test("never renders an em dash", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    root.render(<App />);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.textContent ?? "").not.toContain(EMDASH);

    root.unmount();
    container.remove();
  });
});

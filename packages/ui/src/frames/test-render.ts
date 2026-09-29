// Test-only helper, not exported from the package. packages/ui depends on
// react but not react-dom, so static-markup render tests borrow react-dom
// from the package itself when present, else from the workspace web app.
// When neither resolves, render suites skip and the pure suites still run.
import { join } from "node:path";

export interface StaticRenderer {
  renderToStaticMarkup: (element: unknown) => string;
}

export interface ClientRenderer {
  createRoot: (container: Element) => { render: (element: unknown) => void; unmount: () => void };
}

const bases = [import.meta.dir, join(import.meta.dir, "..", "..", "..", "..", "apps", "web")];

async function load<T>(specifier: string, key: string): Promise<T | null> {
  for (const base of bases) {
    try {
      const mod = (await import(Bun.resolveSync(specifier, base))) as Record<string, unknown>;
      if (typeof mod[key] === "function") return mod as T;
    } catch {
      // try the next base
    }
  }
  return null;
}

export const staticRenderer = await load<StaticRenderer>("react-dom/server", "renderToStaticMarkup");

/** Only when a DOM is registered (happy-dom preload, e.g. bun test from the repo root). */
export const clientRenderer =
  typeof document === "undefined" ? null : await load<ClientRenderer>("react-dom/client", "createRoot");

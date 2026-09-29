// Test helpers for packages/cats: a React root on the happy-dom document,
// a reduced motion switch, and a controllable IntersectionObserver.
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Mounted {
  host: HTMLElement;
  render(node: ReactNode): void;
  unmount(): void;
}

export function mount(node: ReactNode): Mounted {
  const host = document.createElement("div");
  document.body.appendChild(host);
  let root: Root | null = createRoot(host);
  const render = (next: ReactNode) => {
    act(() => root!.render(next));
  };
  render(node);
  return {
    host,
    render,
    unmount() {
      act(() => root?.unmount());
      root = null;
      host.remove();
    },
  };
}

/** Answers the reduced motion query with `reduce`; returns the restore function. */
export function emulateReducedMotion(reduce: boolean): () => void {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) =>
    ({
      matches: query.includes("prefers-reduced-motion") ? reduce : false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

export interface FakeObserver {
  callback: IntersectionObserverCallback;
  targets: Element[];
  fire(isIntersecting: boolean): void;
}

/** Replaces IntersectionObserver with one the test drives; returns the created observers and a restore. */
export function fakeIntersection(): { observers: FakeObserver[]; restore(): void } {
  const original = globalThis.IntersectionObserver;
  const observers: FakeObserver[] = [];
  class Fake {
    callback: IntersectionObserverCallback;
    targets: Element[] = [];
    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback;
      observers.push(this as unknown as FakeObserver);
    }
    observe(el: Element) {
      this.targets.push(el);
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
    fire(isIntersecting: boolean) {
      const entries = this.targets.map((target) => ({ target, isIntersecting }) as unknown as IntersectionObserverEntry);
      act(() => this.callback(entries, this as unknown as IntersectionObserver));
    }
  }
  (globalThis as { IntersectionObserver: unknown }).IntersectionObserver = Fake;
  return {
    observers,
    restore() {
      (globalThis as { IntersectionObserver: unknown }).IntersectionObserver = original;
    },
  };
}

export async function wait(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** Class names that only exist while the cat animates. */
export const MOTION_CLASS = /(^|\s)(cat--live|cat-quirk-[a-z]+|cat-celebrate|cat-react-tap)(\s|$)/;

export function motionClasses(root: ParentNode): string[] {
  const found: string[] = [];
  root.querySelectorAll("[class]").forEach((el) => {
    const cls = el.getAttribute("class") ?? "";
    if (MOTION_CLASS.test(cls)) found.push(cls);
  });
  return found;
}

// The preview borrows react-dom from the workspace web app (packages/ui has
// no react-dom dependency). build.ts resolves this alias at bundle time.
declare module "@kit-preview/react-dom-client" {
  import type { ReactNode } from "react";
  export function createRoot(container: Element): { render(node: ReactNode): void; unmount(): void };
}

// Page B borrows the opt-in motion module (templates/modules/motion) the way
// a client project would after copying it. packages/ui never depends on
// lenis or gsap, so the types are declared here and build.ts resolves the
// alias, plus lenis and gsap, from KIT_PREVIEW_DEPS (a scratch install).
declare module "@kit-preview/motion" {
  import type { ReactNode } from "react";
  export function SmoothScroll(props: { children: ReactNode; touch?: "native" | "smooth"; anchors?: boolean; headerOffset?: number; lerp?: number }): ReactNode;
  export function KitMotion(props: { tier?: 1 | 2 | 3 }): ReactNode;
  export function useScrollRefresh(): void;
}

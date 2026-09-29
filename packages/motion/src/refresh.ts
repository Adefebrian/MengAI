// Scroll measurement refresh: Lenis's limit and every ScrollTrigger's start
// and end are measured, so they go stale when fonts swap in, when the
// scroller resizes, or when content changes height (a late image, a
// disclosure, a tab panel). One batched refresh per frame, whatever asked.
//
// Window resizes are also caught by ScrollTrigger's own listener; watching
// the wrapper here covers a contained shell's main, which can resize without
// the window doing so, and the content covers height changes nothing else
// reports.

export interface Refresher {
  /** Ask for a refresh; many asks in one frame run it once. */
  request(): void;
  cancel(): void;
}

export function createRefresher(
  run: () => void,
  raf: (cb: () => void) => number = (cb) => requestAnimationFrame(cb),
  caf: (id: number) => void = (id) => cancelAnimationFrame(id),
): Refresher {
  let frame = 0;
  let pending = false;
  return {
    request() {
      if (pending) return;
      pending = true;
      frame = raf(() => {
        pending = false;
        run();
      });
    },
    cancel() {
      if (!pending) return;
      pending = false;
      caf(frame);
    },
  };
}

export interface ResizeObserverLike {
  observe(el: Element): void;
  disconnect(): void;
}

export interface WatchDeps {
  /** document.fonts; absent on the server and in old engines. */
  fonts?: { ready: Promise<unknown>; addEventListener?: (t: "loadingdone", cb: () => void) => void; removeEventListener?: (t: "loadingdone", cb: () => void) => void } | null;
  /** Elements whose size changes invalidate measurements (the content, and a contained wrapper). */
  observe: Element[];
  createObserver?: ((cb: (entries: { target: Element; contentRect: { width: number; height: number } }[]) => void) => ResizeObserverLike) | null;
  refresher: Refresher;
}

/** Wire the refresh sources; returns the unwatch. */
export function watchRefresh(d: WatchDeps): () => void {
  let alive = true;
  const ask = () => alive && d.refresher.request();
  d.fonts?.ready.then(ask, () => {});
  d.fonts?.addEventListener?.("loadingdone", ask);
  const last = new Map<Element, string>();
  const ro = d.createObserver?.((entries) => {
    let changed = false;
    for (const e of entries) {
      const size = `${Math.round(e.contentRect.width)}x${Math.round(e.contentRect.height)}`;
      const prev = last.get(e.target);
      last.set(e.target, size);
      // The first report is the observe itself, not a change.
      if (prev !== undefined && prev !== size) changed = true;
    }
    if (changed) ask();
  });
  for (const el of d.observe) ro?.observe(el);
  return () => {
    alive = false;
    d.fonts?.removeEventListener?.("loadingdone", ask);
    ro?.disconnect();
    d.refresher.cancel();
  };
}

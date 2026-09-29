import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, type ReactElement } from "react";
import {
  AppShell,
  getScroller,
  nextShellScroll,
  scrollerRoot,
  SHELL_CONDENSE_AT,
  type AppShellBar,
  type AppShellDestination,
  type AppShellHeader,
  type AppShellProps,
  type AppShellScroll,
  type ShellScrollState,
} from "./AppShell";
import { clientRenderer, staticRenderer } from "./frames/test-render";

const destinations: AppShellDestination[] = [
  { id: "home", label: "Home", href: "/" },
  { id: "work", label: "Work", href: "/work" },
  { id: "about", label: "About", href: "/about" },
];

const seven: AppShellDestination[] = ["a", "b", "c", "d", "e", "f", "g"].map((id) => ({ id, label: id.toUpperCase(), href: `/${id}` }));

function shell(scroll?: AppShellScroll, props: Partial<AppShellProps> = {}): ReactElement {
  return (
    <AppShell title="Demo" destinations={destinations} current="home" scroll={scroll} {...props}>
      <section id="content">Content</section>
    </AppShell>
  );
}

const HEADERS: AppShellHeader[] = ["rail", "island", "masthead"];
const BARS: AppShellBar[] = ["bar", "dock", "split"];

describe.skipIf(staticRenderer === null)("AppShell markup", () => {
  const render = (el: ReactElement) => staticRenderer!.renderToStaticMarkup(el);

  test("defaults to document scroll and leaves the archetype to the direction", () => {
    const html = render(shell());
    expect(html).toContain('data-scroll="document"');
    expect(html).not.toContain("data-jal-scroller");
    expect(html).not.toContain("data-header=");
    expect(html).not.toContain("data-bar=");
  });

  test("renders a skip link first, a header holding the one Primary nav, and one main", () => {
    const html = render(shell("document"));
    expect(html).toMatch(/^<div class="shell"[^>]*><a class="shell-skip" href="#main">Skip to content<\/a><header class="shell-header">/);
    expect(html).toContain('<main id="main" class="shell-main">');
    expect(html.match(/<nav /g)?.length).toBe(1);
    expect(html).toMatch(
      /<header class="shell-header"><div class="shell-bar"><p class="shell-title">Demo<\/p><span class="shell-mark" aria-hidden="true">Demo<\/span><nav class="shell-nav" aria-label="Primary"><div class="shell-dock"><div class="shell-nav-track">/,
    );
    // Every destination is one link, and exactly one is current.
    expect(html.match(/class="shell-nav-item"/g)?.length).toBe(3);
    expect(html.match(/aria-current="page"/g)?.length).toBe(1);
  });

  for (const header of HEADERS) {
    for (const bar of BARS) {
      test(`${header} + ${bar} keeps the landmarks and the current page`, () => {
        const html = render(shell("document", { archetype: { header, bar }, primaryAction: { label: "Buy", href: "#buy" } }));
        expect(html).toContain(`data-header="${header}"`);
        expect(html).toContain(`data-bar="${bar}"`);
        expect(html).toContain('<header class="shell-header">');
        expect(html).toContain('class="shell-main"');
        expect(html.match(/aria-label="Primary"/g)?.length).toBe(1);
        expect(html.match(/href="\/" class="shell-nav-item" aria-current="page"/g)?.length).toBe(1);
        // The one primary action: a header button and the split segment.
        expect(html).toContain('<a class="btn shell-cta" href="#buy">Buy</a>');
        expect(html).toContain('<a class="shell-nav-action" href="#buy" aria-label="Buy">');
        // One sliding indicator per track, hidden from assistive tech.
        expect(html.match(/<span class="shell-ind" aria-hidden="true"><\/span>/g)?.length).toBe(1);
      });
    }
  }

  test("labels and hideOnScroll are passed through as data attributes", () => {
    const html = render(shell("document", { archetype: { labels: "active" }, hideOnScroll: true }));
    expect(html).toContain('data-labels="active"');
    expect(html).toContain('data-hide=""');
  });

  test("contained mode marks main as the declared scroller", () => {
    const html = render(shell("contained"));
    expect(html).toContain('data-scroll="contained"');
    expect(html).toContain('<main id="main" class="shell-main" data-jal-scroller="">');
    expect(html).toContain('aria-label="Primary"');
  });

  test("more than 5 destinations: 4 plus More in the nav, the rest in one sheet", () => {
    const html = render(<AppShell title="Demo" destinations={seven} current="f"><p>x</p></AppShell>);
    const nav = html.slice(html.indexOf('class="shell-nav"'), html.indexOf("</nav>", html.indexOf('class="shell-nav"')));
    expect(nav.match(/<a /g)?.length).toBe(4);
    expect(nav.match(/<button /g)?.length).toBe(1);
    expect(nav).toContain('data-more="bar"');
    const sheet = html.slice(html.indexOf('class="shell-sheet"'));
    expect(sheet).toContain('popover="auto"');
    expect(sheet.match(/class="shell-nav-item shell-sheet-item"/g)?.length).toBe(3);
    // f is current and lives in the sheet, so More carries the active state.
    expect(nav).toMatch(/data-more="bar" data-active=""/);
    expect(sheet).toContain('href="/f" class="shell-nav-item shell-sheet-item" aria-current="page"');
    const target = html.match(/popoverTarget="([^"]+)"|popovertarget="([^"]+)"/i);
    expect(target).not.toBeNull();
    expect(html).toContain(`id="${target![1] ?? target![2]}" class="shell-sheet"`);
  });

  test("5 or fewer destinations need no More and no sheet", () => {
    const html = render(<AppShell title="Demo" destinations={seven.slice(0, 5)} current="a"><p>x</p></AppShell>);
    expect(html).not.toContain("data-more=");
    expect(html).not.toContain("shell-sheet");
  });

  test("split with an action holds 3 destinations plus More when there are 5", () => {
    const html = render(
      <AppShell title="Demo" destinations={seven.slice(0, 5)} current="a" primaryAction={{ label: "New", href: "#new" }}>
        <p>x</p>
      </AppShell>,
    );
    const bar = html.slice(html.indexOf('class="shell-nav"'));
    expect(bar.match(/data-split-overflow=""/g)?.length).toBe(2);
    expect(bar).toContain('data-more="split"');
    expect(html).toContain('data-has-action=""');
    // The sheet item that only the split bar sends to More is marked so.
    expect(html.match(/data-split-only=""/g)?.length).toBe(1);
  });

  test("badges are flat, hidden from the accessibility tree, and named on the link", () => {
    const html = render(
      <AppShell
        title="Demo"
        destinations={[
          { id: "inbox", label: "Inbox", href: "/inbox", badge: 12, icon: <svg /> },
          { id: "feed", label: "Feed", href: "/feed", badge: true },
          { id: "me", label: "Me", href: "/me" },
        ]}
        current="me"
      >
        <p>x</p>
      </AppShell>,
    );
    expect(html).toContain('aria-label="Inbox, 12 new"');
    expect(html).toContain('aria-label="Feed, new"');
    // An icon destination carries its badge in the icon pill (below 640px)
    // and after the label (from 640px); CSS shows one.
    expect(html.match(/<span class="shell-badge" aria-hidden="true">9\+<\/span>/g)?.length).toBe(2);
    expect(html).toContain('<span class="shell-badge" data-kind="dot" aria-hidden="true"></span>');
  });

  test("a wordmark keeps the title as its accessible name, and brandHref makes it a link", () => {
    const html = render(shell("document", { brand: <svg viewBox="0 0 10 2" />, brandHref: "/" }));
    expect(html).toContain('<a class="shell-title shell-brand" href="/" aria-label="Demo"><svg');
    // The masthead's compact mark repeats the wordmark out of the tab order
    // and the accessibility tree, so the brand is named and reached once.
    expect(html).toContain('<a class="shell-mark" href="/" aria-hidden="true" tabindex="-1"><svg');
  });

  test("data-icons marks a shell whose destinations carry icons", () => {
    expect(render(shell())).not.toContain("data-icons");
    const html = render(
      <AppShell title="Demo" destinations={destinations.map((d) => ({ ...d, icon: <svg /> }))} current="home">
        <p>x</p>
      </AppShell>,
    );
    expect(html).toContain('data-icons=""');
    expect(html.match(/<span class="shell-nav-icon"><svg><\/svg><\/span>/g)?.length).toBe(3);
  });
});

describe("nextShellScroll", () => {
  const start: ShellScrollState = { y: 0, anchor: 0, dir: "up", scrolled: false, compact: false, hidden: false };

  test("condenses past 24px, compacts past 64px, hides past 160px on the way down", () => {
    expect(nextShellScroll(start, SHELL_CONDENSE_AT, false).scrolled).toBe(false);
    const a = nextShellScroll(start, 40, false);
    expect(a).toMatchObject({ scrolled: true, dir: "down", compact: false, hidden: false });
    const b = nextShellScroll(a, 100, false);
    expect(b).toMatchObject({ compact: true, hidden: false });
    const c = nextShellScroll(b, 200, false);
    expect(c).toMatchObject({ compact: true, hidden: true });
    const d = nextShellScroll(c, 180, false);
    expect(d).toMatchObject({ dir: "up", compact: false, hidden: false, scrolled: true });
  });

  test("ignores under 6px of travel, so jitter never flips the direction", () => {
    const a = nextShellScroll(start, 300, false);
    expect(nextShellScroll(a, 296, false).dir).toBe("down");
    expect(nextShellScroll(a, 290, false).dir).toBe("up");
  });

  test("reduced motion condenses (a tone change) but never compacts or hides", () => {
    const a = nextShellScroll(nextShellScroll(start, 100, true), 400, true);
    expect(a).toMatchObject({ scrolled: true, compact: false, hidden: false });
  });

  test("the top of the page always reads as scrolling up", () => {
    const a = nextShellScroll(start, 400, false);
    expect(nextShellScroll(a, 0, false)).toMatchObject({ dir: "up", scrolled: false, compact: false });
  });
});

describe("AppShell CSS", () => {
  const css = readFileSync(join(import.meta.dir, "ui.css"), "utf8");
  const start = css.indexOf("/* App-shell");
  const block = css.slice(start, css.indexOf("/* =====", start));

  test("document mode pins the header sticky and the bottom bar fixed, reserving its height", () => {
    expect(block).toMatch(/\n\.shell-header \{[^}]*position: sticky;[^}]*top: 0;[^}]*height: calc\(var\(--shell-header-h\) \+ env\(safe-area-inset-top\)\);/);
    expect(block).toMatch(/\n\.shell-nav \{[^}]*position: fixed;[^}]*bottom: 0;[^}]*env\(safe-area-inset-bottom\)/);
    expect(block).toMatch(/\n\.shell \{[^}]*padding-bottom: calc\(var\(--shell-nav-h\) \+ env\(safe-area-inset-bottom\)\);/);
  });

  test("the shell heights are declared where html can read them", () => {
    expect(block).toMatch(/html:has\(\.shell:not\(\[data-scroll="contained"\]\)\)\s*\{[^}]*var\(--shell-header-h[^}]*var\(--shell-nav-h/);
    // Every declaration sits on :root, a direction, the shell's own archetype
    // attribute, contained mode, or html through :has().
    const rules = [...block.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => /--shell-(nav|header)-h:/.test(m[2]));
    expect(rules.length).toBeGreaterThanOrEqual(6);
    for (const [, selectors] of rules) {
      const list = selectors.replace(/\/\*[\s\S]*?\*\//g, "").trim();
      for (const sel of list.split(/,\s*(?![^(]*\))/)) {
        expect(/^(:root|:is\(\[data-direction|html:has\(|\.shell\[data-(header|bar|scroll)=)/.test(sel.trim())).toBe(true);
      }
    }
    // :root carries a default for both, and the default bundles come first.
    expect(block).toMatch(/:root,\n:is\(\[data-direction="D1"\][^{]*\{\n[^}]*--shell-header-h:/);
    expect(block).toMatch(/:root,\n:is\(\[data-direction="D1"\][^{]*\{\n[^}]*--shell-nav-h:/);
  });

  test("every direction maps to exactly one header and one bottom bar", () => {
    const bundles = [...block.matchAll(/([^{}]*\.shell\[data-(header|bar)="(\w+)"\][^{]*)\{/g)];
    for (const kind of ["header", "bar"]) {
      const own = bundles.filter((b) => b[2] === kind && /^:is\(|^:root/m.test(b[1].trim()));
      const hits = new Map<string, number>();
      for (const b of own) {
        const first = b[1].trim().split("\n").find((l) => l.startsWith(":is("))!;
        for (const d of first.matchAll(/data-direction="(D\d+)"/g)) hits.set(d[1], (hits.get(d[1]) ?? 0) + 1);
      }
      for (let i = 1; i <= 13; i++) expect(hits.get(`D${i}`)).toBe(1);
    }
  });

  test("contained mode resets the condense knobs on the shell, after every bundle", () => {
    // A bundle computes --_hd-row2-cond on the direction element against the
    // document header height; a contained shell must never move its row, so
    // the knobs (not the transforms) are reset on the shell itself, in a rule
    // that sits after every bundle and matches with the same specificity as
    // .shell[data-header], so it wins by order.
    const at = block.indexOf('\n.shell[data-scroll="contained"] {');
    expect(at).toBeGreaterThan(0);
    const rule = block.slice(at, block.indexOf("}", at));
    expect(rule).toContain("--_hd-title-cond: none;");
    expect(rule).toContain("--_hd-row2-cond: none;");
    expect(rule).toContain("--_hd-title-fade: 0;");
    expect(rule).toContain("--shell-header-h: var(--_hd-hc);");
    for (const m of block.matchAll(/\.shell\[data-(header|bar)="\w+"\]/g)) expect(m.index!).toBeLessThan(at);
    // The scrolled transforms read the knobs; none is hard-coded.
    for (const m of block.matchAll(/\.shell\[data-scrolled\][^{]*\{([^}]*)\}/g)) {
      const t = m[1].match(/transform:\s*([^;]+);/);
      if (t) expect(t[1]).toMatch(/^var\(--_hd-/);
    }
  });

  test("every knob the rules read is set by every bundle of its kind", () => {
    const bundles = [...block.matchAll(/([^{}]*\.shell\[data-(header|bar)="(\w+)"\][^{]*)\{([^}]*)\}/g)];
    const rules = block.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [prefix, kind] of [["_hd", "header"], ["_nb", "bar"]] as const) {
      const own = bundles.filter((b) => b[2] === kind);
      expect(own.length).toBe(3);
      const read = new Set([...rules.matchAll(new RegExp(`var\\(--${prefix}-([\\w-]+)`, "g"))].map((m) => m[1]));
      for (const b of own) {
        const set = new Set([...b[4].matchAll(new RegExp(`--${prefix}-([\\w-]+):`, "g"))].map((m) => m[1]));
        // Labels live in their own bundle pair.
        for (const knob of read) if (!knob.startsWith("lbl")) expect([b[3], knob, set.has(knob)]).toEqual([b[3], knob, true]);
      }
    }
  });

  test("chrome radius is concentric and capped, and compaction lives only below 640px under .shell-motion", () => {
    expect(block).toContain("--_hd-r: min(var(--radius-16), var(--kit-radius-card, var(--radius-12)) + var(--space-4px));");
    expect(block).toContain("--_hd-inner-r: max(var(--radius-4) / 2, var(--_hd-r) - var(--_hd-pad));");
    expect(block).toMatch(/--_nb-r: min\(var\(--space-20px\), var\(--kit-radius-card, var\(--radius-12\)\) \+ var\(--space-8px\)\);/);
    const mobile = block.indexOf("@media (max-width: 639.98px)");
    expect(mobile).toBeGreaterThan(0);
    const flat = block.replace(/@(media|supports|starting-style)[^{]*\{/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const compact = [...flat.matchAll(/([^{}]+)\{[^}]*\}/g)].filter((m) => m[1].includes("[data-compact]"));
    expect(compact.length).toBeGreaterThan(0);
    for (const m of compact) {
      for (const sel of m[1].trim().split(/,\s*(?![^(]*\))/)) expect(sel.trim()).toMatch(/^(\.shell)?\.shell-motion\[data-compact\]/);
    }
    // Every compaction rule sits inside the below-640px block.
    for (const m of block.matchAll(/\[data-compact\][^{]*\{/g)) expect(m.index!).toBeGreaterThan(mobile);
  });

  test("contained mode keeps the viewport grid with an inner scroller", () => {
    expect(block).toMatch(/\.shell\[data-scroll="contained"\]\s*\{[^}]*height: 100dvh;/);
    expect(block).toMatch(/\.shell\[data-scroll="contained"\] > \.shell-main\s*\{[^}]*position: relative;[^}]*overflow-y: auto;/);
    // The frame is border-box, so the reserved bar height stays inside 100dvh.
    expect(block).toMatch(/\n\.shell \{[^}]*box-sizing: border-box;/);
  });

  test("the shell block has no gradient, shadow, glow, blur, raw colour, or em-dash", () => {
    expect(block).not.toMatch(/gradient|text-shadow|drop-shadow|glow|blur|backdrop/);
    for (const m of block.matchAll(/box-shadow:\s*([^;]+);/g)) expect(m[1].trim()).toBe("none");
    // Tokens only: no hex, rgb, hsl, or named purple.
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|purple|violet|indigo/);
    expect(block).not.toContain("\u2014");
  });

  test("every transition lives under .shell-motion and uses the duration tokens and the one curve", () => {
    // Flatten at-rules, so each match is one selector list and its block.
    const flat = block.replace(/@(media|starting-style)[^{]*\{/g, "");
    for (const m of flat.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const decl = m[2].match(/transition(-duration)?:\s*([^;]+);/);
      if (!decl) continue;
      const selectors = m[1].replace(/\/\*[\s\S]*?\*\//g, "").trim();
      if (decl[2].trim() === "none") continue;
      for (const sel of selectors.split(/,\s*(?![^(]*\))/)) expect(sel.trim().startsWith(".shell-motion")).toBe(true);
      for (const t of decl[2].split(",")) {
        expect(t).toMatch(/var\(--dur-\d+(-exit)?\)/);
        if (!decl[1]) expect(t).toMatch(/var\(--ease-standard\)|allow-discrete/);
      }
    }
  });
});

// Live DOM path. Runs when happy-dom is registered (bun test from the
// template root preloads it); skips under a bare packages/ui run.
describe.skipIf(clientRenderer === null)("AppShell in a DOM", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const frame = () => new Promise((r) => setTimeout(r, 40));
  const restores: (() => void)[] = [];
  afterEach(() => {
    while (restores.length) restores.pop()!();
  });

  async function mount(el: ReactElement) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = clientRenderer!.createRoot(container);
    await act(async () => {
      root.render(el);
    });
    return {
      container,
      rerender: async (next: ReactElement) => {
        await act(async () => {
          root.render(next);
        });
      },
      cleanup: () => {
        act(() => root.unmount());
        container.remove();
      },
    };
  }

  function stubReducedMotion(reduce: boolean) {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: reduce && q.includes("reduce"),
      media: q,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
    restores.push(() => {
      window.matchMedia = original;
    });
  }

  test("document mode (the default) resolves to window", async () => {
    const { container, cleanup } = await mount(shell());
    try {
      const content = container.querySelector("#content")!;
      expect(container.querySelector(".shell")!.getAttribute("data-scroll")).toBe("document");
      expect(container.querySelector("nav")!.getAttribute("aria-label")).toBe("Primary");
      expect(getScroller(content)).toBe(window);
      expect(getScroller()).toBe(window);
      expect(scrollerRoot(getScroller(content))).toBeNull();
    } finally {
      cleanup();
    }
  });

  test("contained mode resolves to the shell main, even before it overflows", async () => {
    const { container, cleanup } = await mount(shell("contained"));
    try {
      const main = container.querySelector("main.shell-main")!;
      const content = container.querySelector("#content")!;
      expect(getScroller(content)).toBe(main);
      expect(getScroller()).toBe(main);
      expect(scrollerRoot(getScroller(content))).toBe(main);
    } finally {
      cleanup();
    }
  });

  test("motion allowed: .shell-motion arrives one frame after mount", async () => {
    stubReducedMotion(false);
    const { container, cleanup } = await mount(shell());
    try {
      await frame();
      expect(container.querySelector(".shell")!.classList.contains("shell-motion")).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("reduced motion: no transition class, and scrolling never compacts or hides", async () => {
    stubReducedMotion(true);
    const { container, cleanup } = await mount(shell("contained", { hideOnScroll: true }));
    try {
      await frame();
      const el = container.querySelector(".shell")!;
      expect(el.classList.contains("shell-motion")).toBe(false);
      const main = container.querySelector<HTMLElement>("main.shell-main")!;
      main.scrollTop = 0;
      Object.defineProperty(main, "scrollTop", { configurable: true, get: () => 500 });
      main.dispatchEvent(new Event("scroll"));
      await frame();
      expect(el.hasAttribute("data-scrolled")).toBe(true);
      expect(el.hasAttribute("data-compact")).toBe(false);
      expect(el.hasAttribute("data-hidden")).toBe(false);
      expect(el.classList.contains("shell-motion")).toBe(false);
    } finally {
      cleanup();
    }
  });

  test("scroll state lands on the shell, rAF-throttled, from the real scroller", async () => {
    stubReducedMotion(false);
    const { container, cleanup } = await mount(shell("contained"));
    try {
      const el = container.querySelector(".shell")!;
      const main = container.querySelector<HTMLElement>("main.shell-main")!;
      let y = 0;
      Object.defineProperty(main, "scrollTop", { configurable: true, get: () => y });
      y = 120;
      main.dispatchEvent(new Event("scroll"));
      main.dispatchEvent(new Event("scroll"));
      await frame();
      expect(el.hasAttribute("data-scrolled")).toBe(true);
      expect(el.getAttribute("data-dir")).toBe("down");
      expect(el.hasAttribute("data-compact")).toBe(true);
      y = 60;
      main.dispatchEvent(new Event("scroll"));
      await frame();
      expect(el.getAttribute("data-dir")).toBe("up");
      expect(el.hasAttribute("data-compact")).toBe(false);
    } finally {
      cleanup();
    }
  });

  test("the scroll listener is passive and removed on unmount (document and contained)", async () => {
    const add = spyOn(window, "addEventListener");
    const remove = spyOn(window, "removeEventListener");
    restores.push(() => {
      add.mockRestore();
      remove.mockRestore();
    });
    const doc = await mount(shell());
    const added = add.mock.calls.filter((c) => c[0] === "scroll");
    expect(added.length).toBe(1);
    expect(added[0][2]).toMatchObject({ passive: true });
    doc.cleanup();
    expect(remove.mock.calls.some((c) => c[0] === "scroll" && c[1] === added[0][1])).toBe(true);

    const contained = await mount(shell("contained"));
    const main = contained.container.querySelector("main.shell-main")!;
    const mainAdd = spyOn(main, "removeEventListener");
    contained.cleanup();
    expect(mainAdd.mock.calls.some((c) => c[0] === "scroll")).toBe(true);
  });

  test("the indicator follows the current destination", async () => {
    const props = { title: "Demo", destinations, children: <p>x</p> };
    const { container, rerender, cleanup } = await mount(<AppShell {...props} current="home" />);
    try {
      const track = container.querySelector<HTMLElement>(".shell-nav-track")!;
      track.querySelectorAll<HTMLElement>("a.shell-nav-item").forEach((a, i) => {
        Object.defineProperty(a, "offsetLeft", { configurable: true, get: () => 8 + i * 90 });
        Object.defineProperty(a, "offsetWidth", { configurable: true, get: () => 80 + i });
      });
      await rerender(<AppShell {...props} current="work" />);
      expect(track.style.getPropertyValue("--shell-ind-x")).toBe("98px");
      expect(track.style.getPropertyValue("--shell-ind-w")).toBe("81px");
      expect(track.hasAttribute("data-ind")).toBe(true);
      await rerender(<AppShell {...props} current="about" />);
      expect(track.style.getPropertyValue("--shell-ind-x")).toBe("188px");
      expect(track.querySelector('[aria-current="page"]')!.textContent).toBe("About");
    } finally {
      cleanup();
    }
  });

  test("more than 5 destinations warns in development; so does fewer than 3", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    restores.push(() => warn.mockRestore());
    const many = await mount(<AppShell title="Demo" destinations={seven} current="a"><p>x</p></AppShell>);
    expect(
      warn.mock.calls.some((c) => String(c[0]).includes("7 destinations") && String(c[0]).includes("rejects") && String(c[0]).includes("More")),
    ).toBe(true);
    many.cleanup();
    warn.mockClear();
    const few = await mount(<AppShell title="Demo" destinations={destinations.slice(0, 2)} current="home"><p>x</p></AppShell>);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("needs 3 to 5"))).toBe(true);
    few.cleanup();
  });

  test("scrollspy: anchor destinations follow the section in view, rooted on the scroller", async () => {
    const observers: { cb: IntersectionObserverCallback; root: Element | null; targets: Element[]; off: boolean }[] = [];
    const Original = globalThis.IntersectionObserver;
    class Stub {
      rec: (typeof observers)[number];
      constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) {
        this.rec = { cb, root: (opts?.root as Element | null) ?? null, targets: [], off: false };
        observers.push(this.rec);
      }
      observe(t: Element) {
        this.rec.targets.push(t);
      }
      unobserve() {}
      disconnect() {
        this.rec.off = true;
      }
      takeRecords() {
        return [];
      }
    }
    globalThis.IntersectionObserver = Stub as unknown as typeof IntersectionObserver;
    restores.push(() => {
      globalThis.IntersectionObserver = Original;
    });
    const anchors: AppShellDestination[] = [
      { id: "top", label: "Top", href: "#s-top" },
      { id: "specs", label: "Specs", href: "#s-specs" },
      { id: "faq", label: "FAQ", href: "#s-faq" },
    ];
    const { container, cleanup } = await mount(
      <AppShell title="Demo" destinations={anchors} current="top" scroll="contained">
        <section id="s-top">a</section>
        <section id="s-specs">b</section>
        <section id="s-faq">c</section>
      </AppShell>,
    );
    try {
      expect(observers.length).toBe(1);
      expect(observers[0].root).toBe(container.querySelector("main.shell-main"));
      expect(observers[0].targets.map((t) => t.id)).toEqual(["s-top", "s-specs", "s-faq"]);
      const [, specs] = observers[0].targets;
      await act(async () => {
        observers[0].cb(
          [
            { isIntersecting: false, target: observers[0].targets[0] },
            { isIntersecting: true, target: specs },
          ] as unknown as IntersectionObserverEntry[],
          {} as IntersectionObserver,
        );
      });
      const currents = [...container.querySelectorAll('[aria-current="page"]')].map((a) => a.getAttribute("href"));
      expect(currents).toEqual(["#s-specs"]);
    } finally {
      cleanup();
    }
    expect(observers[0].off).toBe(true);
  });

  test("an overflowing overflow-y auto ancestor counts as the scroller", () => {
    const box = document.createElement("div");
    box.style.overflowY = "auto";
    Object.defineProperty(box, "scrollHeight", { value: 800 });
    Object.defineProperty(box, "clientHeight", { value: 200 });
    const child = document.createElement("p");
    box.appendChild(child);
    document.body.appendChild(box);
    try {
      expect(getScroller(child)).toBe(box);
    } finally {
      box.remove();
    }
  });

  function carousel(spill: number) {
    // Browsers compute overflow-y to auto when overflow-x is auto, so set both.
    const track = document.createElement("div");
    track.style.overflowX = "auto";
    track.style.overflowY = "auto";
    Object.defineProperty(track, "scrollHeight", { value: 200 + spill });
    Object.defineProperty(track, "clientHeight", { value: 200 });
    const card = document.createElement("article");
    track.appendChild(card);
    return { track, card };
  }

  test("a horizontal carousel with 1px of vertical spill is not the scroller", () => {
    const { track, card } = carousel(1);
    document.body.appendChild(track);
    try {
      expect(getScroller(card)).toBe(window);
    } finally {
      track.remove();
    }
  });

  test("a carousel inside a declared scroller resolves to the declared scroller", () => {
    const main = document.createElement("main");
    main.setAttribute("data-jal-scroller", "");
    const { track, card } = carousel(1);
    main.appendChild(track);
    document.body.appendChild(main);
    try {
      expect(getScroller(card)).toBe(main);
    } finally {
      main.remove();
    }
  });

  test("a carousel that truly overflows vertically still counts", () => {
    const { track, card } = carousel(300);
    document.body.appendChild(track);
    try {
      expect(getScroller(card)).toBe(track);
    } finally {
      track.remove();
    }
  });
});

// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The bridge's side of the hit rects and the pointer call back: hit rects go to
// the shell as whole points that cover the shape (a bad rect never costs the
// resize), the shell's __islandPointer call is read defensively and reaches
// every listener until it unsubscribes, and the preview records the rects and
// plays pointer calls by hand.
import { describe, expect, test } from "bun:test";
import { MAX_HIT, nativeBand, nativeHit, previewBridge, readPointer, tauriBridge, type IslandPointer, type PointerHost } from "../native";

const fakeShell = () => {
  const invoked: Array<{ cmd: string; args: unknown }> = [];
  const invoke = async (cmd: string, args?: Record<string, unknown>) => {
    invoked.push({ cmd, args });
    return null;
  };
  return { invoked, invoke };
};

describe("hit rects", () => {
  test("they cover the fractional rect in whole points, at most four, and drop what the shell would refuse", () => {
    expect(nativeHit(undefined)).toBeUndefined();
    expect(nativeHit([])).toBeUndefined();
    expect(nativeHit([{ x: 0, y: 0, width: 400, height: 118 }])).toEqual([{ x: 0, y: 0, width: 400, height: 118 }]);
    // edges go outwards: 10.6..58.2 becomes 10..59
    expect(nativeHit([{ x: 10.6, y: 117.5, width: 47.6, height: 72.2 }])).toEqual([{ x: 10, y: 117, width: 49, height: 73 }]);
    // a negative size holds nothing but keeps its place (the first rect is the shape)
    expect(nativeHit([{ x: 5, y: 5, width: -3, height: 10 }])).toEqual([{ x: 5, y: 5, width: 0, height: 10 }]);
    const bad = [
      { x: Number.NaN, y: 0, width: 10, height: 10 },
      { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 10 },
      { x: Number.MAX_VALUE, y: 0, width: Number.MAX_VALUE, height: 10 },
    ];
    expect(nativeHit(bad)).toBeUndefined();
    expect(nativeHit([...bad, { x: 1, y: 2, width: 3, height: 4 }])).toEqual([{ x: 1, y: 2, width: 3, height: 4 }]);
    const many = Array.from({ length: 6 }, (_, i) => ({ x: i, y: 0, width: 1, height: 1 }));
    expect(nativeHit(many)?.map((r) => r.x)).toEqual([0, 1, 2, 3]);
    expect(MAX_HIT).toBe(4);
  });

  test("inside Tauri island_set_state carries hit only when the page sends one", async () => {
    const shell = fakeShell();
    const bridge = tauriBridge(shell.invoke, {});
    await bridge.setState({ state: "collapsed", width: 299.2, height: 32 });
    await bridge.setState({ state: "expanded", width: 400, height: 189.5, hit: [{ x: 0, y: 0, width: 400, height: 117.4 }, { x: 176, y: 117.4, width: 48, height: 72 }] });
    await bridge.setState({ state: "peek", width: 300, height: 60, hit: [{ x: Number.NaN, y: 0, width: 1, height: 1 }] });
    expect(shell.invoked).toEqual([
      { cmd: "island_set_state", args: { state: "collapsed", width: 300, height: 32 } },
      {
        cmd: "island_set_state",
        args: { state: "expanded", width: 400, height: 190, hit: [{ x: 0, y: 0, width: 400, height: 118 }, { x: 176, y: 117, width: 48, height: 73 }] },
      },
      { cmd: "island_set_state", args: { state: "peek", width: 300, height: 60 } },
    ]);
    expect(Object.keys(shell.invoked[0]!.args as object)).not.toContain("hit");
  });

  test("the preview records the rects the shell would get", async () => {
    const bridge = previewBridge(undefined, () => {});
    await bridge.setState({ state: "collapsed", width: 299.2, height: 32 });
    await bridge.setState({ state: "expanded", width: 400, height: 190, hit: [{ x: 0.5, y: 0, width: 399, height: 118 }] });
    expect(bridge.calls).toEqual([
      { cmd: "island_set_state", args: { state: "collapsed", width: 300, height: 32 } },
      { cmd: "island_set_state", args: { state: "expanded", width: 400, height: 190, hit: [{ x: 0, y: 0, width: 400, height: 118 }] } },
    ]);
    expect("hit" in bridge.calls[0]!.args).toBe(false);
  });
});

describe("the folded ears' band", () => {
  test("it covers the fractional span in whole points and drops what the shell would refuse", () => {
    expect(nativeBand(undefined)).toBeUndefined();
    expect(nativeBand({ x: -107.5, width: 400 })).toEqual({ x: -108, width: 401 });
    expect(nativeBand({ x: -108, width: 401 })).toEqual({ x: -108, width: 401 });
    for (const bad of [{ x: Number.NaN, width: 10 }, { x: 0, width: Number.POSITIVE_INFINITY }, { x: Number.MAX_VALUE, width: Number.MAX_VALUE }, { x: 4, width: 0 }, { x: 4, width: -3 }]) {
      expect(nativeBand(bad)).toBeUndefined();
    }
  });

  test("inside Tauri island_set_state carries it only while the page sends one; the preview records it", async () => {
    const shell = fakeShell();
    const bridge = tauriBridge(shell.invoke, {});
    await bridge.setState({ state: "collapsed", width: 185, height: 32, band: { x: -107.5, width: 400 } });
    await bridge.setState({ state: "collapsed", width: 185, height: 32, band: { x: Number.NaN, width: 400 } });
    await bridge.setState({ state: "collapsed", width: 400, height: 32 });
    expect(shell.invoked).toEqual([
      { cmd: "island_set_state", args: { state: "collapsed", width: 185, height: 32, band: { x: -108, width: 401 } } },
      { cmd: "island_set_state", args: { state: "collapsed", width: 185, height: 32 } },
      { cmd: "island_set_state", args: { state: "collapsed", width: 400, height: 32 } },
    ]);
    const preview = previewBridge(undefined, () => {});
    await preview.setState({ state: "collapsed", width: 185, height: 32, band: { x: -107.5, width: 400 } });
    expect(preview.calls).toEqual([{ cmd: "island_set_state", args: { state: "collapsed", width: 185, height: 32, band: { x: -108, width: 401 } } }]);
  });
});

describe("the pointer call back", () => {
  test("the shell's payload is read defensively", () => {
    expect(readPointer({ zone: "near", x: -20.5, y: 10 })).toEqual({ zone: "near", x: -20.5, y: 10 });
    expect(readPointer({ zone: "inside", x: "1", y: Number.NaN })).toEqual({ zone: "inside", x: 0, y: 0 });
    expect(readPointer({ zone: "far", x: 1e9, y: -1e9 })).toEqual({ zone: "far", x: 0, y: 0 });
    for (const bad of [null, undefined, 1, "near", {}, { zone: "Near" }, { zone: "close", x: 1, y: 1 }, { zone: ["near"] }]) {
      expect(readPointer(bad)).toBeNull();
    }
  });

  test("inside Tauri onPointer installs window.__islandPointer and removes it with the last listener", () => {
    const host: PointerHost = {};
    const bridge = tauriBridge(fakeShell().invoke, host);
    const a: IslandPointer[] = [];
    const b: IslandPointer[] = [];
    const offA = bridge.onPointer((p) => a.push(p));
    const offB = bridge.onPointer((p) => b.push(p));
    expect(typeof host.__islandPointer).toBe("function");
    host.__islandPointer!({ zone: "near", x: -20, y: 10 });
    host.__islandPointer!({ zone: "bogus", x: 0, y: 0 });
    host.__islandPointer!("<img src=x>");
    expect(a).toEqual([{ zone: "near", x: -20, y: 10 }]);
    expect(b).toEqual(a);
    offA();
    host.__islandPointer!({ zone: "inside", x: 200, y: 50 });
    expect(a).toHaveLength(1);
    expect(b.at(-1)).toEqual({ zone: "inside", x: 200, y: 50 });
    offB();
    expect(host.__islandPointer).toBeUndefined();
    offB();
    expect(host.__islandPointer).toBeUndefined();
  });

  test("an unsubscribe leaves a call back that someone else installed alone", () => {
    const host: PointerHost = {};
    const off = tauriBridge(fakeShell().invoke, host).onPointer(() => {});
    const theirs = () => {};
    host.__islandPointer = theirs;
    off();
    expect(host.__islandPointer).toBe(theirs);
  });

  test("the preview installs nothing and plays pointer calls by hand", () => {
    const bridge = previewBridge(undefined, () => {});
    const seen: IslandPointer[] = [];
    const off = bridge.onPointer((p) => seen.push(p));
    expect((window as unknown as PointerHost).__islandPointer).toBeUndefined();
    bridge.emitPointer({ zone: "near", x: 3, y: 4 });
    bridge.emitPointer({ zone: "nowhere" });
    off();
    bridge.emitPointer({ zone: "far", x: 0, y: 0 });
    expect(seen).toEqual([{ zone: "near", x: 3, y: 4 }]);
  });
});

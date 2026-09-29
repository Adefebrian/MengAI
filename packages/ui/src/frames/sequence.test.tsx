import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { staticRenderer } from "./test-render";
import { Composition } from "./Composition";
import { useCurrentFrame, useVideoConfig } from "./context";
import { Sequence, Series, sequenceFrame, seriesOffsets } from "./Sequence";

// Render suites need react-dom (see test-render.ts); pure suites always run.
const server = staticRenderer;

describe("sequenceFrame", () => {
  test("is null before from and at or after the window end", () => {
    expect(sequenceFrame(9, 10, 20)).toBeNull();
    expect(sequenceFrame(30, 10, 20)).toBeNull();
    expect(sequenceFrame(31, 10, 20)).toBeNull();
  });

  test("returns the local frame inside the window", () => {
    expect(sequenceFrame(10, 10, 20)).toBe(0);
    expect(sequenceFrame(29, 10, 20)).toBe(19);
    expect(sequenceFrame(500, 10, Infinity)).toBe(490);
  });

  test("nested windows compose", () => {
    const outer = sequenceFrame(45, 30, 60);
    expect(outer).toBe(15);
    expect(sequenceFrame(outer as number, 5, 20)).toBe(10);
    expect(sequenceFrame(outer as number, 20, 20)).toBeNull();
  });
});

describe("seriesOffsets", () => {
  test("lays items end to end", () => {
    expect(seriesOffsets([{ durationInFrames: 30 }, { durationInFrames: 45 }, { durationInFrames: 10 }])).toEqual([
      0, 30, 75,
    ]);
  });

  test("offset shifts an item and everything after it", () => {
    expect(
      seriesOffsets([{ durationInFrames: 30 }, { durationInFrames: 30, offset: -10 }, { durationInFrames: 30, offset: 5 }]),
    ).toEqual([0, 20, 55]);
  });

  test("only the last item may be infinite", () => {
    expect(seriesOffsets([{ durationInFrames: 10 }, { durationInFrames: Infinity }])).toEqual([0, 10]);
    expect(() => seriesOffsets([{ durationInFrames: Infinity }, { durationInFrames: 10 }])).toThrow(RangeError);
    expect(() => seriesOffsets([{ durationInFrames: 0 }])).toThrow(RangeError);
  });
});

function ShowFrame({ tag }: { tag: string }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return <span>{`${tag}:${frame}/${durationInFrames}`}</span>;
}

const config = { fps: 30, durationInFrames: 120, width: 1280, height: 720 };

describe.skipIf(server === null)("Sequence rendering", () => {
  const render = (frame: number, node: ReactElement) =>
    server!.renderToStaticMarkup(
      <Composition {...config} frame={frame}>
        {node}
      </Composition>,
    );

  test("children see a local frame and the composition config", () => {
    const html = render(
      40,
      <Sequence from={30} durationInFrames={20} name="intro">
        <ShowFrame tag="a" />
      </Sequence>,
    );
    expect(html).toContain("a:10/120");
    expect(html).toContain('data-sequence="intro"');
  });

  test("children are not rendered outside the window", () => {
    const node = (
      <Sequence from={30} durationInFrames={20}>
        <ShowFrame tag="a" />
      </Sequence>
    );
    expect(render(29, node)).not.toContain("a:");
    expect(render(50, node)).not.toContain("a:");
  });

  test("nested Sequences subtract each from", () => {
    const html = render(
      45,
      <Sequence from={30}>
        <Sequence from={5} layout="none">
          <ShowFrame tag="n" />
        </Sequence>
      </Sequence>,
    );
    expect(html).toContain("n:10/120");
  });

  test("Series plays one item at a time with local frames", () => {
    const node = (
      <Series>
        <Series.Sequence durationInFrames={30}>
          <ShowFrame tag="one" />
        </Series.Sequence>
        <Series.Sequence durationInFrames={30}>
          <ShowFrame tag="two" />
        </Series.Sequence>
      </Series>
    );
    const early = render(12, node);
    expect(early).toContain("one:12/120");
    expect(early).not.toContain("two:");
    const late = render(42, node);
    expect(late).toContain("two:12/120");
    expect(late).not.toContain("one:");
  });

  test("hooks outside a composition throw a clear error", () => {
    expect(() => server!.renderToStaticMarkup(<ShowFrame tag="x" />)).toThrow(/inside a FrameProvider/);
  });
});

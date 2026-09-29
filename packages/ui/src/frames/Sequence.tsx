// Sequence and Series: time structure. Children of a Sequence see a local
// frame that starts at 0 on the Sequence's `from`, and are not rendered at
// all outside its window. Series lays Sequences end to end.
import { Children, Fragment, isValidElement, useMemo } from "react";
import type { ReactElement, ReactNode } from "react";
import { FrameContext, useFrameState } from "./context";
import type { FrameState } from "./context";

/**
 * Local frame for a Sequence window, or null when the parent frame is
 * outside [from, from + durationInFrames).
 */
export function sequenceFrame(parentFrame: number, from: number, durationInFrames: number): number | null {
  if (parentFrame < from) return null;
  if (parentFrame >= from + durationInFrames) return null;
  return parentFrame - from;
}

export interface SequenceProps {
  /** Parent frame on which this Sequence's local frame 0 lands. Default 0. */
  from?: number;
  /** Window length in frames. Default Infinity (runs to the end). */
  durationInFrames?: number;
  /**
   * `fill` (default) renders a wrapper that fills the stage, so scenes stack
   * as layers. `none` renders children with no wrapper.
   */
  layout?: "fill" | "none";
  /** Shown as data-sequence for debugging and tests. */
  name?: string;
  children?: ReactNode;
}

function assertSequenceProps(from: number, durationInFrames: number): void {
  if (!Number.isFinite(from)) throw new RangeError("Sequence: from must be a finite number");
  if (!(durationInFrames > 0)) throw new RangeError("Sequence: durationInFrames must be > 0");
}

export function Sequence({ from = 0, durationInFrames = Infinity, layout = "fill", name, children }: SequenceProps) {
  assertSequenceProps(from, durationInFrames);
  const parent = useFrameState("Sequence");
  const local = sequenceFrame(parent.frame, from, durationInFrames);
  const value = useMemo<FrameState | null>(
    () => (local === null ? null : { frame: local, config: parent.config }),
    [local, parent.config],
  );
  if (value === null) return null;
  const body = layout === "fill" ? (
    <div className="frames-fill" data-sequence={name}>
      {children}
    </div>
  ) : (
    <Fragment>{children}</Fragment>
  );
  return <FrameContext.Provider value={value}>{body}</FrameContext.Provider>;
}

export interface SeriesItem {
  durationInFrames: number;
  /** Shift this item relative to the end of the previous one. Negative overlaps. */
  offset?: number;
}

/** Start frame of each Series item. */
export function seriesOffsets(items: readonly SeriesItem[]): number[] {
  const starts: number[] = [];
  let cursor = 0;
  items.forEach((item, index) => {
    const offset = item.offset ?? 0;
    if (!Number.isFinite(offset)) throw new RangeError("Series.Sequence: offset must be finite");
    if (!(item.durationInFrames > 0)) throw new RangeError("Series.Sequence: durationInFrames must be > 0");
    if (!Number.isFinite(item.durationInFrames) && index !== items.length - 1) {
      throw new RangeError("Series.Sequence: only the last item may have an infinite duration");
    }
    const start = cursor + offset;
    starts.push(start);
    cursor = start + item.durationInFrames;
  });
  return starts;
}

export interface SeriesSequenceProps extends SeriesItem {
  layout?: "fill" | "none";
  name?: string;
  children?: ReactNode;
}

function SeriesSequence(_props: SeriesSequenceProps): ReactElement {
  throw new Error("Series.Sequence must be a direct child of Series");
}

export interface SeriesProps {
  children?: ReactNode;
}

function SeriesRoot({ children }: SeriesProps) {
  const items = Children.toArray(children).filter(isValidElement) as ReactElement<SeriesSequenceProps>[];
  for (const item of items) {
    if (item.type !== SeriesSequence) throw new Error("Series only accepts Series.Sequence children");
  }
  const starts = seriesOffsets(items.map((item) => item.props));
  return (
    <Fragment>
      {items.map((item, index) => (
        <Sequence
          key={item.key ?? index}
          from={starts[index]}
          durationInFrames={item.props.durationInFrames}
          layout={item.props.layout}
          name={item.props.name}
        >
          {item.props.children}
        </Sequence>
      ))}
    </Fragment>
  );
}

export const Series = Object.assign(SeriesRoot, { Sequence: SeriesSequence });

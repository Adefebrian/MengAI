// Composition: renders one frame of a frame-driven piece on a stage that
// keeps the authored aspect ratio and scales the authored pixel canvas to
// the container width. It has no clock; Player drives `frame`.
import { createElement, useCallback, useRef, useState } from "react";
import type { ComponentType, CSSProperties, ReactNode } from "react";
import { FrameProvider } from "./context";
import type { VideoConfig } from "./context";

export interface CompositionProps<P extends object = Record<string, never>> extends VideoConfig {
  /** Frame to render. Default 0. */
  frame?: number;
  /** Scene component. Receives `inputProps`. Use this or `children`. */
  component?: ComponentType<P>;
  inputProps?: P;
  children?: ReactNode;
  className?: string;
}

/** Container width / authored width, the uniform scale for the canvas. */
export function fitScale(containerWidth: number, width: number): number {
  if (!(containerWidth > 0) || !(width > 0)) return 1;
  return containerWidth / width;
}

// A callback ref measures during commit, before paint, like a layout
// effect, but stays silent under server rendering.
function useFitScale(width: number) {
  const [scale, setScale] = useState(1);
  const observer = useRef<ResizeObserver | null>(null);

  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      observer.current?.disconnect();
      observer.current = null;
      if (!el) return;
      const measure = () => setScale(fitScale(el.clientWidth, width));
      measure();
      if (typeof ResizeObserver === "undefined") return;
      observer.current = new ResizeObserver(measure);
      observer.current.observe(el);
    },
    [width],
  );

  return { ref, scale };
}

export function Composition<P extends object = Record<string, never>>({
  fps,
  durationInFrames,
  width,
  height,
  frame = 0,
  component,
  inputProps,
  children,
  className,
}: CompositionProps<P>) {
  const { ref, scale } = useFitScale(width);
  const stageStyle: CSSProperties = { aspectRatio: `${width} / ${height}` };
  const canvasStyle: CSSProperties = {
    width,
    height,
    transform: `scale(${scale})`,
  };
  const content = component ? createElement(component, (inputProps ?? {}) as P) : children;

  return (
    <div ref={ref} className={["frames-stage", className].filter(Boolean).join(" ")} style={stageStyle}>
      <div className="frames-canvas" style={canvasStyle}>
        <FrameProvider frame={frame} config={{ fps, durationInFrames, width, height }}>
          {content}
        </FrameProvider>
      </div>
    </div>
  );
}

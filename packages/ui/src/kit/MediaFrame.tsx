// MediaFrame: every image, video, canvas, or live product view on a kit
// page. A fixed aspect ratio (no layout shift), the direction's media
// radius, a full hairline, and a caption below the media, never over it.
//   image        width and height set, lazy unless priority (the LCP media
//                gets fetchpriority high and is never lazy)
//   video        muted, looped, inline, preload metadata, with a poster;
//                autoplay only when reduced motion is off
//   canvas       any drawn child (a <canvas>, an R3F root). The
//                frame keeps page chrome law; what draws inside a canvas
//                follows the jal-immersive canvas zone (lighting and shading
//                only, the page white showing through)
//   view         a live product view built from DOM (a readout, a
//                list, a real input): in flow, the ratio is its minimum
//   placeholder  an honest fixed-ratio placeholder naming the intended
//                subject, swapped for real media in one line
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { usePrefersReducedMotion } from "../frames/Player";

export type MediaRatio = "21/9" | "16/9" | "3/2" | "4/3" | "1/1" | "4/5" | "3/4";

export interface MediaFrameProps {
  kind?: "image" | "video" | "canvas" | "view" | "placeholder";
  ratio?: MediaRatio;
  src?: string;
  /** Describes the subject. Required for image and placeholder; "" marks decoration. */
  alt?: string;
  poster?: string;
  width?: number;
  height?: number;
  /** The LCP media: eager, fetchpriority high. */
  priority?: boolean;
  caption?: ReactNode;
  /** Frame fill behind the media: layer (default) or surface. */
  tone?: "layer" | "surface";
  /** The canvas slot content. */
  children?: ReactNode;
}

function Video({ src, poster, alt }: { src?: string; poster?: string; alt?: string }) {
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLVideoElement>(null);
  // The server snapshot reports reduced motion, so autoPlay is false in the
  // HTML and only flips on after hydration; some browsers never start a
  // video whose autoplay attribute arrived late. Start it explicitly.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced) {
      el.pause();
      return;
    }
    const started = el.play();
    if (started && typeof started.catch === "function") started.catch(() => {});
  }, [reduced]);
  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      muted
      loop
      playsInline
      preload="metadata"
      autoPlay={!reduced}
      aria-label={alt || undefined}
      aria-hidden={alt === "" ? true : undefined}
    />
  );
}

export function MediaFrame({
  kind = "image",
  ratio = "16/9",
  src,
  alt,
  poster,
  width,
  height,
  priority = false,
  caption,
  tone = "layer",
  children,
}: MediaFrameProps) {
  const style = { "--kit-ratio": ratio.replace("/", " / ") } as CSSProperties;
  let content: ReactNode;
  if (kind === "image") {
    content = (
      <img
        src={src}
        alt={alt ?? ""}
        width={width}
        height={height}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        decoding="async"
      />
    );
  } else if (kind === "video") {
    content = <Video src={src} poster={poster} alt={alt} />;
  } else if (kind === "placeholder") {
    // TODO: replace with real media at this ratio; the alt names the subject.
    content = (
      <div className="kit-media-slot kit-media-placeholder" role="img" aria-label={alt}>
        <span className="kit-meta">{alt}</span>
      </div>
    );
  } else if (kind === "view") {
    content = <div className="kit-media-view">{children}</div>;
  } else {
    content = (
      <div className="kit-media-slot" data-jal-canvas="">
        {children}
      </div>
    );
  }
  return (
    <figure className="kit-media" data-kind={kind} data-tone={tone}>
      <div className="kit-media-frame" style={style}>
        {content}
      </div>
      {caption ? <figcaption className="kit-meta">{caption}</figcaption> : null}
    </figure>
  );
}

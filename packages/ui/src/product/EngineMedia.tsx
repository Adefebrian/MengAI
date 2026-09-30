// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// EngineMedia: an image or a clip the crew engine made, in the kit's
// MediaFrame shape (the same figure, frame and ratio classes, so kit.css
// draws it exactly like a MediaFrame). The difference is the load mode:
// every img and video carries crossOrigin="anonymous", so the MengAI
// website, a different origin from the engine on 127.0.0.1, fetches the
// file in CORS mode. The engine answers allowlisted origins with CORS and
// keeps Cross-Origin-Resource-Policy same-origin, which only blocks no-cors
// loads. Served by the engine itself the request is same-origin and loads
// as before. Video: muted, looped, inline, preload metadata; autoplay only
// when reduced motion is off.
import { useEffect, useRef, type CSSProperties } from "react";
import { usePrefersReducedMotion } from "../frames/Player";
import type { MediaRatio } from "../kit/MediaFrame";

export interface EngineMediaProps {
  kind: "image" | "video";
  src: string;
  /** Describes the subject; "" marks decoration. */
  alt: string;
  ratio?: MediaRatio;
  width?: number;
  height?: number;
  poster?: string;
  tone?: "layer" | "surface";
}

/** The load mode every engine file uses from a page of another origin. */
export const ENGINE_CROSS_ORIGIN = "anonymous" as const;

function EngineVideo({ src, poster, alt }: { src: string; poster?: string; alt: string }) {
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLVideoElement>(null);
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
      crossOrigin={ENGINE_CROSS_ORIGIN}
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

export function EngineMedia({ kind, src, alt, ratio = "16/9", width, height, poster, tone = "layer" }: EngineMediaProps) {
  const style = { "--kit-ratio": ratio.replace("/", " / ") } as CSSProperties;
  return (
    <figure className="kit-media" data-kind={kind} data-tone={tone}>
      <div className="kit-media-frame" style={style}>
        {kind === "image" ? (
          <img src={src} alt={alt} width={width} height={height} crossOrigin={ENGINE_CROSS_ORIGIN} loading="lazy" decoding="async" />
        ) : (
          <EngineVideo src={src} poster={poster} alt={alt} />
        )}
      </div>
    </figure>
  );
}

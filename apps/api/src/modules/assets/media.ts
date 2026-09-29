// Media helpers for the assets module: magic-byte sniffing, the mime
// allowlist we are willing to serve inline, file extensions, and default
// per-unit price estimates for cost records.
import type { AssetKind } from "@mengai/shared";

/** Only these types are ever served inline. Everything else (SVG included) is an attachment. */
export const INLINE_MIMES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

export const OCTET = "application/octet-stream";

const ascii = (b: Uint8Array, at: number, len: number) => String.fromCharCode(...b.subarray(at, at + len));

export function sniffMime(b: Uint8Array): string | null {
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === "PNG") return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a")) return "image/gif";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "image/webp";
  if (b.length >= 12 && ascii(b, 4, 4) === "ftyp") return ascii(b, 8, 4) === "qt  " ? "video/quicktime" : "video/mp4";
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video/webm";
  return null;
}

/**
 * Settles the stored type: the sniffed type wins, a declared type is kept
 * only when it is on the allowlist and matches the asset kind, anything else
 * becomes application/octet-stream (served as a download, never rendered).
 */
export function settleMime(kind: AssetKind, declared: string | undefined, data: Uint8Array): { mime: string; ext: string } {
  const sniffed = sniffMime(data);
  const pick = sniffed ?? (declared ? declared.toLowerCase().split(";")[0]!.trim() : null);
  if (pick && INLINE_MIMES[pick] && pick.startsWith(kind === "image" ? "image/" : "video/")) return { mime: pick, ext: INLINE_MIMES[pick]! };
  return { mime: OCTET, ext: "bin" };
}

export function isInlineMime(mime: string | null | undefined): boolean {
  return !!mime && mime in INLINE_MIMES;
}

export function extFor(mime: string | null | undefined): string {
  return (mime && INLINE_MIMES[mime]) || "bin";
}

/**
 * Default USD estimates per generated unit, matched by exact model id then
 * longest prefix (vendor path prefixes stripped). Vendors change prices;
 * unknown models record 0 rather than a guess.
 */
export const MEDIA_PRICES: Record<string, { perImage?: number; perSecond?: number }> = {
  "gpt-image-1-mini": { perImage: 0.011 },
  "gpt-image-1": { perImage: 0.042 },
  "dall-e-3": { perImage: 0.04 },
  "dall-e-2": { perImage: 0.02 },
  "imagen-4": { perImage: 0.04 },
  "gemini-2.5-flash-image": { perImage: 0.039 },
  "sora-2-pro": { perSecond: 0.3 },
  "sora-2": { perSecond: 0.1 },
  "veo-3-fast": { perSecond: 0.15 },
  "veo-3.1-fast": { perSecond: 0.15 },
  "veo-3": { perSecond: 0.4 },
};

export function mediaCost(kind: AssetKind, model: string, units: { images?: number; seconds?: number }): number {
  const bare = model.includes("/") ? model.slice(model.lastIndexOf("/") + 1) : model;
  let price: { perImage?: number; perSecond?: number } | undefined = MEDIA_PRICES[bare];
  if (!price) {
    let best: string | null = null;
    for (const key of Object.keys(MEDIA_PRICES)) if (bare.startsWith(key) && (!best || key.length > best.length)) best = key;
    price = best ? MEDIA_PRICES[best] : undefined;
  }
  if (!price) return 0;
  const usd = kind === "image" ? (price.perImage ?? 0) * (units.images ?? 1) : (price.perSecond ?? 0) * (units.seconds ?? 0);
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/** Video aspect from the shared size enum (videos reuse the image size field). */
export function aspectFor(size: string | undefined): "16:9" | "9:16" | "1:1" | undefined {
  if (size === "1536x1024") return "16:9";
  if (size === "1024x1536") return "9:16";
  if (size === "1024x1024") return "1:1";
  return undefined;
}

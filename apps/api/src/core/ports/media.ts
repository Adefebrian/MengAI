// Image and video generation port (BYOK). Adapters: openai_images,
// gemini_media, fal_queue, replicate. Video is always an async job.
import type { ProviderProtocol } from "@mengai/shared";

export interface ImageRequest {
  model: string;
  prompt: string;
  size?: "1024x1024" | "1536x1024" | "1024x1536";
  n?: number;
  signal?: AbortSignal;
}

export interface GeneratedMedia {
  data: Uint8Array;
  mime: string;
  width?: number;
  height?: number;
  durationMs?: number;
}

export interface VideoRequest {
  model: string;
  prompt: string;
  durationSec?: number;
  aspect?: "16:9" | "9:16" | "1:1";
  signal?: AbortSignal;
}

export interface VideoPoll {
  status: "queued" | "running" | "done" | "failed";
  progress?: number;
  video?: GeneratedMedia;
  error?: string;
}

export interface MediaProvider {
  readonly id: string;
  readonly protocol: ProviderProtocol;
  generateImage?(req: ImageRequest): Promise<{ images: GeneratedMedia[] }>;
  startVideo?(req: VideoRequest): Promise<{ jobId: string }>;
  pollVideo?(jobId: string, signal?: AbortSignal): Promise<VideoPoll>;
}

/** Implemented by the providers module. */
export interface MediaRouter {
  resolve(kind: "image" | "video", override?: { providerId?: string; model?: string }): Promise<{ provider: MediaProvider; model: string }>;
}

// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Local blob store (local mode, and the server fallback when S3 is not
// configured): files under <dataDir>/blobs. Keys are validated so a key can
// never leave the root (no "..", no absolute paths, no dot segments), and the
// resolved path is checked against the root once more before any fs call.
import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { BlobStore } from "../ports/blob";

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_KEY = 512;

/** Returns the normalized key or throws. Shared with the S3 adapter. */
export function sanitizeBlobKey(key: string): string {
  if (typeof key !== "string" || key.length === 0 || key.length > MAX_KEY) throw new Error("invalid blob key");
  if (key.includes("\0") || key.includes("\\")) throw new Error("invalid blob key");
  const parts = key.split("/");
  for (const part of parts) {
    if (!SEGMENT.test(part) || part === "." || part === ".." || part.includes("..")) throw new Error("invalid blob key");
  }
  return parts.join("/");
}

export async function toBytes(data: Uint8Array | Blob | ArrayBuffer): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(await data.arrayBuffer());
}

export function createFsBlobStore(dataDir: string): BlobStore & { readonly root: string } {
  const root = resolve(dataDir, "blobs");
  // content types live beside the data under a dot folder no key can name
  const metaRoot = join(root, ".meta");

  function paths(key: string): { file: string; meta: string } {
    const clean = sanitizeBlobKey(key);
    const file = resolve(root, clean);
    const meta = resolve(metaRoot, `${clean}.json`);
    if (!file.startsWith(root + sep) || !meta.startsWith(metaRoot + sep)) throw new Error("invalid blob key");
    return { file, meta };
  }

  async function isFile(path: string): Promise<boolean> {
    try {
      return (await stat(path)).isFile();
    } catch {
      return false;
    }
  }

  return {
    root,
    async put(key, data, contentType) {
      const { file, meta } = paths(key);
      const bytes = await toBytes(data);
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      await mkdir(dirname(meta), { recursive: true, mode: 0o700 });
      await Bun.write(file, bytes);
      await Bun.write(meta, JSON.stringify({ contentType }));
      return { key: sanitizeBlobKey(key), size: bytes.byteLength };
    },
    async get(key) {
      const { file, meta } = paths(key);
      if (!(await isFile(file))) return null;
      const data = new Uint8Array(await Bun.file(file).arrayBuffer());
      let contentType = "application/octet-stream";
      try {
        const m = (await Bun.file(meta).json()) as { contentType?: unknown };
        if (typeof m.contentType === "string" && m.contentType) contentType = m.contentType;
      } catch {
        // missing meta: generic type
      }
      return { data, contentType };
    },
    async delete(key) {
      const { file, meta } = paths(key);
      await rm(file, { force: true });
      await rm(meta, { force: true });
    },
    async exists(key) {
      return isFile(paths(key).file);
    },
  };
}

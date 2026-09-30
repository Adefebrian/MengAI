// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Binary objects: generated assets, screenshots, exports.
// local mode = files under <dataDir>/blobs, server mode = S3-compatible (Bun.s3).
export interface BlobStore {
  put(key: string, data: Uint8Array | Blob | ArrayBuffer, contentType: string): Promise<{ key: string; size: number }>;
  get(key: string): Promise<{ data: Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

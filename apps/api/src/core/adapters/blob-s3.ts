// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// S3-compatible blob store over Bun's built-in S3Client (server mode).
// Keys go through the same validation as the fs store.
import { S3Client } from "bun";
import type { BlobStore } from "../ports/blob";
import type { S3Config } from "../config";
import { sanitizeBlobKey, toBytes } from "./blob-fs";

export function createS3BlobStore(config: S3Config, prefix = "mengai/"): BlobStore {
  const client = new S3Client({
    endpoint: config.endpoint,
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    ...(config.region ? { region: config.region } : {}),
  });
  const k = (key: string) => prefix + sanitizeBlobKey(key);

  return {
    async put(key, data, contentType) {
      const bytes = await toBytes(data);
      await client.write(k(key), bytes, { type: contentType });
      return { key: sanitizeBlobKey(key), size: bytes.byteLength };
    },
    async get(key) {
      const file = client.file(k(key));
      if (!(await file.exists())) return null;
      const [stat, buf] = await Promise.all([file.stat(), file.arrayBuffer()]);
      return { data: new Uint8Array(buf), contentType: stat.type || "application/octet-stream" };
    },
    async delete(key) {
      await client.delete(k(key));
    },
    async exists(key) {
      return client.exists(k(key));
    },
  };
}

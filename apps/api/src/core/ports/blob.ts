// Binary objects: generated assets, screenshots, exports.
// local mode = files under <dataDir>/blobs, server mode = S3-compatible (Bun.s3).
export interface BlobStore {
  put(key: string, data: Uint8Array | Blob | ArrayBuffer, contentType: string): Promise<{ key: string; size: number }>;
  get(key: string): Promise<{ data: Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

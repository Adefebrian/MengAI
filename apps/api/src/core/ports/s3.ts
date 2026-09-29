// Port interface for object storage. Modules depend on this shape, never on
// `@aws-sdk/client-s3` directly. See core/adapters/s3.ts for the concrete
// adapter.
export interface ObjectStorePort {
  /** Writes `body` to `key` in the configured bucket. */
  putObject(key: string, body: string | Uint8Array): Promise<void>;
  /** Reads the object at `key`, or `null` if it does not exist. */
  getObject(key: string): Promise<string | null>;
}

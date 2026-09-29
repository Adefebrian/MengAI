// Secret storage for BYOK keys. local mode = OS keychain (Bun.secrets),
// server mode = envelope encryption (AES-256-GCM, KEK from env) in the DB.
// A secret value is only ever read by the adapter that sends it to its
// provider; it is never logged, returned by the API, or put into a prompt.
export interface Vault {
  readonly kind: "keychain" | "envelope" | "memory";
  set(ref: string, secret: string): Promise<void>;
  get(ref: string): Promise<string | null>;
  delete(ref: string): Promise<void>;
  has(ref: string): Promise<boolean>;
}

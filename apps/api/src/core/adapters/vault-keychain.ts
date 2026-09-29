// Local mode vault: the macOS keychain through Bun.secrets. Service is the
// app bundle id, the account name is the secret ref. Values handed out are
// registered with the redactor so any echo of them is scrubbed.
import { forgetSecret, registerSecret } from "../../lib/redact";
import type { Vault } from "../ports/vault";

export interface SecretsApi {
  get(opts: { service: string; name: string }): Promise<string | null>;
  set(opts: { service: string; name: string; value: string }): Promise<void>;
  delete(opts: { service: string; name: string }): Promise<boolean>;
}

const REF = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/;

export function assertRef(ref: string): string {
  if (typeof ref !== "string" || !REF.test(ref)) throw new Error("invalid vault ref");
  return ref;
}

export function createKeychainVault(service: string, secrets: SecretsApi = Bun.secrets): Vault {
  return {
    kind: "keychain",
    async set(ref, secret) {
      if (typeof secret !== "string" || secret.length === 0) throw new Error("vault secret must be a non-empty string");
      await secrets.set({ service, name: assertRef(ref), value: secret });
      registerSecret(secret);
    },
    async get(ref) {
      const value = await secrets.get({ service, name: assertRef(ref) });
      if (value) registerSecret(value);
      return value ?? null;
    },
    async delete(ref) {
      const value = await secrets.get({ service, name: assertRef(ref) });
      await secrets.delete({ service, name: ref });
      if (value) forgetSecret(value);
    },
    async has(ref) {
      return (await secrets.get({ service, name: assertRef(ref) })) !== null;
    },
  };
}

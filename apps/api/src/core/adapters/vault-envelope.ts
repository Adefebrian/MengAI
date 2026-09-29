// Server mode vault: envelope encryption with WebCrypto AES-256-GCM.
// Each secret gets a fresh random 256-bit data key (DEK). The secret is
// encrypted with the DEK, the DEK is encrypted ("wrapped") with the key
// encryption key (KEK) from VAULT_KEK. Both ciphertexts are bound to the ref
// through GCM additional data, so a row copied under another ref fails to
// decrypt. Rows live in vault_items (ciphertext, iv, dek_wrapped).
//
//   ciphertext  = base64(AES-GCM(DEK, iv, secret, aad "mengai:v1:val:<ref>"))
//   iv          = base64(12 random bytes)
//   dek_wrapped = "v1." + base64(wrapIv(12) || AES-GCM(KEK, wrapIv, DEK, aad "mengai:v1:dek:<ref>"))
import { forgetSecret, registerSecret } from "../../lib/redact";
import type { Clock } from "../ports/clock";
import type { Db } from "../ports/db";
import type { Vault } from "../ports/vault";
import { assertRef } from "./vault-keychain";

const VERSION = "v1";
const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const unb64 = (text: string) => new Uint8Array(Buffer.from(text, "base64"));
const aad = (kind: "val" | "dek", ref: string) => enc.encode(`mengai:${VERSION}:${kind}:${ref}`);

async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new Uint8Array(raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function importKek(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.byteLength !== 32) throw new Error("VAULT_KEK must be 32 bytes");
  return importAesKey(raw);
}

export interface EnvelopeVaultOptions {
  db: Db;
  /** 32 raw bytes */
  kek: Uint8Array;
  clock: Clock;
}

export async function createEnvelopeVault(opts: EnvelopeVaultOptions): Promise<Vault> {
  const { db, clock } = opts;
  const kek = await importKek(opts.kek);

  async function seal(ref: string, secret: string) {
    const dekRaw = crypto.getRandomValues(new Uint8Array(32));
    const dek = await importAesKey(dekRaw);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad("val", ref) }, dek, enc.encode(secret)));
    const wrapIv = crypto.getRandomValues(new Uint8Array(12));
    const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: wrapIv, additionalData: aad("dek", ref) }, kek, dekRaw));
    dekRaw.fill(0);
    const packed = new Uint8Array(wrapIv.byteLength + wrapped.byteLength);
    packed.set(wrapIv, 0);
    packed.set(wrapped, wrapIv.byteLength);
    return { ciphertext: b64(ct), iv: b64(iv), dekWrapped: `${VERSION}.${b64(packed)}` };
  }

  async function open(ref: string, row: { ciphertext: string; iv: string; dek_wrapped: string }): Promise<string> {
    const [version, packedB64] = row.dek_wrapped.split(".", 2);
    if (version !== VERSION || !packedB64) throw new Error("unsupported vault item version");
    const packed = unb64(packedB64);
    const wrapIv = packed.slice(0, 12);
    const wrapped = packed.slice(12);
    const dekRaw = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: wrapIv, additionalData: aad("dek", ref) }, kek, wrapped));
    const dek = await importAesKey(dekRaw);
    dekRaw.fill(0);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(row.iv), additionalData: aad("val", ref) }, dek, unb64(row.ciphertext));
    return dec.decode(plain);
  }

  return {
    kind: "envelope",
    async set(ref, secret) {
      assertRef(ref);
      if (typeof secret !== "string" || secret.length === 0) throw new Error("vault secret must be a non-empty string");
      const sealed = await seal(ref, secret);
      const now = clock.now();
      await db.query`
        insert into vault_items (ref, ciphertext, iv, dek_wrapped, created_at, updated_at)
        values (${ref}, ${sealed.ciphertext}, ${sealed.iv}, ${sealed.dekWrapped}, ${now}, ${now})
        on conflict (ref) do update set
          ciphertext = excluded.ciphertext,
          iv = excluded.iv,
          dek_wrapped = excluded.dek_wrapped,
          updated_at = excluded.updated_at`;
      registerSecret(secret);
    },
    async get(ref) {
      assertRef(ref);
      const rows = await db.query<{ ciphertext: string; iv: string; dek_wrapped: string }>`
        select ciphertext, iv, dek_wrapped from vault_items where ref = ${ref}`;
      const row = rows[0];
      if (!row) return null;
      try {
        const value = await open(ref, row);
        registerSecret(value);
        return value;
      } catch {
        // wrong KEK, tampered row or a row moved under another ref
        throw new Error("vault item could not be decrypted");
      }
    },
    async delete(ref) {
      assertRef(ref);
      const rows = await db.query<{ ciphertext: string; iv: string; dek_wrapped: string }>`
        select ciphertext, iv, dek_wrapped from vault_items where ref = ${ref}`;
      if (rows[0]) {
        try {
          forgetSecret(await open(ref, rows[0]));
        } catch {
          // undecryptable rows are still deleted
        }
      }
      await db.query`delete from vault_items where ref = ${ref}`;
    },
    async has(ref) {
      assertRef(ref);
      const rows = await db.query`select 1 as one from vault_items where ref = ${ref}`;
      return rows.length > 0;
    },
  };
}

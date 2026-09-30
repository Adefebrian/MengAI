// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, test } from "bun:test";
import { clip, keyHint, redact, redactDeep, registerSecret } from "./redact";

describe("redact", () => {
  test("scrubs registered exact secrets and common shapes", () => {
    registerSecret("my-very-private-value-123");
    const out = redact("key my-very-private-value-123 and sk-ant-abcdefghijklmnop and OPENAI_API_KEY=abcdef123456");
    expect(out).not.toContain("my-very-private-value-123");
    expect(out).not.toContain("sk-ant-abcdefghijklmnop");
    expect(out).not.toContain("abcdef123456");
  });
  test("redactDeep masks sensitive keys", () => {
    const out = redactDeep({ apiKey: "x-123456789", nested: { note: "Bearer abcdefghijklmnop" } });
    expect(out.apiKey).toBe("[REDACTED]");
    expect(out.nested.note).not.toContain("abcdefghijklmnop");
  });
  test("keyHint and clip", () => {
    expect(keyHint("sk-1234567890abcd")).toBe("abcd");
    expect(clip("a".repeat(400), 10).length).toBe(10);
  });
});

// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Validation for owner settings. Shared by routes (request bodies) and the
// service (stored rows are re-validated on read, bad rows fall back to the default).
import type { OwnerSettings } from "@mengai/shared";
import { z } from "zod";

export const DEFAULT_SETTINGS: OwnerSettings = {
  defaultBudgetTokens: 400_000,
  defaultBudgetUsd: 5,
  maxConcurrentAgents: 4,
  ceoName: "Oyen",
  maxAgents: 0,
  maxDepth: 0,
  allowNetworkTools: false,
  motion: "full",
  prices: {},
};

const price = z
  .object({
    input: z.number().min(0).max(10_000),
    cachedInput: z.number().min(0).max(10_000),
    cacheWrite: z.number().min(0).max(10_000).optional(),
    output: z.number().min(0).max(10_000),
  })
  .strict();

export const settingsFields = {
  // 0 means unlimited; a real limit starts at 1,000 tokens
  defaultBudgetTokens: z
    .number()
    .int()
    .min(0)
    .max(100_000_000)
    .refine((v) => v === 0 || v >= 1_000, "0 (unlimited) or at least 1000"),
  defaultBudgetUsd: z.number().min(0).max(100_000),
  // the scheduler's concurrency queue stays bounded: the org is unlimited, the cats at work at once are not
  maxConcurrentAgents: z.number().int().min(1).max(16),
  // letters, digits, spaces and . ' - only: no markup, no emoji
  ceoName: z
    .string()
    .trim()
    .min(1)
    .max(24)
    .regex(/^[\p{L}\p{N}][\p{L}\p{N} .'-]*$/u, "letters, digits, spaces and . ' - only"),
  maxAgents: z.number().int().min(0).max(1_000),
  maxDepth: z.number().int().min(0).max(100),
  allowNetworkTools: z.boolean(),
  motion: z.enum(["full", "calm", "off"]),
  prices: z
    .record(z.string().min(1).max(128).regex(/^[A-Za-z0-9._:/@-]+$/, "model id has unsupported characters"), price)
    .refine((v) => Object.keys(v).length <= 200, "at most 200 price overrides"),
} satisfies Record<keyof OwnerSettings, z.ZodTypeAny>;

/** PATCH body: any subset of the fields, nothing else. `prices` replaces the whole override map. */
export const settingsPatchSchema = z.object(settingsFields).partial().strict();

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

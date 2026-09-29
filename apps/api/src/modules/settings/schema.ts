// Validation for owner settings. Shared by routes (request bodies) and the
// service (stored rows are re-validated on read, bad rows fall back to the default).
import type { OwnerSettings } from "@mengai/shared";
import { z } from "zod";

export const DEFAULT_SETTINGS: OwnerSettings = {
  defaultBudgetTokens: 400_000,
  defaultBudgetUsd: 5,
  maxConcurrentAgents: 4,
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
  defaultBudgetTokens: z.number().int().min(1_000).max(100_000_000),
  defaultBudgetUsd: z.number().min(0).max(100_000),
  maxConcurrentAgents: z.number().int().min(1).max(16),
  allowNetworkTools: z.boolean(),
  motion: z.enum(["full", "calm", "off"]),
  prices: z
    .record(z.string().min(1).max(128).regex(/^[A-Za-z0-9._:/@-]+$/, "model id has unsupported characters"), price)
    .refine((v) => Object.keys(v).length <= 200, "at most 200 price overrides"),
} satisfies Record<keyof OwnerSettings, z.ZodTypeAny>;

/** PATCH body: any subset of the fields, nothing else. `prices` replaces the whole override map. */
export const settingsPatchSchema = z.object(settingsFields).partial().strict();

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

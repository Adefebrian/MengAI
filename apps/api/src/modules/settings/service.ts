// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// SettingsService: defaults merged with stored overrides. Every module reads
// settings through this service (injected by the container).
import type { OwnerSettings } from "@mengai/shared";
import type { Clock } from "../../core/ports/clock";
import type { SettingsService } from "../../core/services";
import type { SettingsRepo } from "./repo";
import { DEFAULT_SETTINGS, settingsFields, settingsPatchSchema } from "./schema";

const KEYS = Object.keys(DEFAULT_SETTINGS) as Array<keyof OwnerSettings>;

export function createSettingsService(repo: SettingsRepo, clock: Clock): SettingsService {
  async function get(): Promise<OwnerSettings> {
    const out: OwnerSettings = { ...DEFAULT_SETTINGS, prices: { ...DEFAULT_SETTINGS.prices } };
    for (const row of await repo.all()) {
      if (!(KEYS as string[]).includes(row.key)) continue;
      const key = row.key as keyof OwnerSettings;
      const parsed = settingsFields[key].safeParse(row.value);
      if (parsed.success) (out as unknown as Record<string, unknown>)[key] = parsed.data;
    }
    return out;
  }

  return {
    get,
    async patch(patch) {
      // callers inside the API are typed, but the same bounds apply to them
      const valid = settingsPatchSchema.parse(patch);
      const entries = Object.entries(valid).filter(([, v]) => v !== undefined) as Array<[string, unknown]>;
      await repo.put(entries, clock.now());
      return get();
    },
  };
}

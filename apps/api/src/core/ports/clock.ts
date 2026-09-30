// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Time and id source, injectable so tests are deterministic.
export interface Clock {
  now(): number;
  /** UUIDv7 (time ordered). */
  id(): string;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  id: () => Bun.randomUUIDv7(),
};

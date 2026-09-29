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

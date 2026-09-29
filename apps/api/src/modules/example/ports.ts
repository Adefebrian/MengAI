// The interfaces this module consumes from core. Re-exported, not
// redefined, per the module anatomy in skills/jal-architecture: the
// concrete adapter lives in src/core/, this file only describes the shape
// the module depends on.
export type { CachePort } from "../../core/ports/redis";

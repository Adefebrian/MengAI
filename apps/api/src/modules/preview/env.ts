// The complete environment of a preview process. Built from scratch: PATH,
// HOME, LANG, PORT, HOST=127.0.0.1, BROWSER=none and NODE_ENV=development,
// nothing else. Provider keys, the vault and every MENGAI_* variable never
// reach a preview; PATH entries must be absolute.
import { existsSync } from "node:fs";
import { join } from "node:path";

const SYSTEM_PATH = ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
/** toolchain bin dirs under the home folder, added when present */
const HOME_TOOL_BINS = [".bun/bin", ".cargo/bin", ".local/bin", ".deno/bin", ".volta/bin", "go/bin"];

export const PREVIEW_ENV_KEYS = ["PATH", "HOME", "LANG", "PORT", "HOST", "BROWSER", "NODE_ENV"] as const;

/** the engine's PATH first (the owner's node and bun), then system and toolchain dirs; absolute entries only */
export function previewPath(source: string | undefined, home: string, exists: (p: string) => boolean = existsSync): string {
  const out: string[] = [];
  const add = (p: string) => {
    if (p.startsWith("/") && !p.includes("\0") && !out.includes(p)) out.push(p);
  };
  for (const p of (source ?? "").split(":")) add(p);
  for (const p of SYSTEM_PATH) add(p);
  for (const rel of HOME_TOOL_BINS) {
    const p = join(home, rel);
    if (exists(p)) add(p);
  }
  return out.join(":");
}

export function previewEnv(input: { port: number; home: string; source: Record<string, string | undefined>; exists?: (p: string) => boolean }): Record<string, string> {
  const lang = input.source.LANG ?? "";
  return {
    PATH: previewPath(input.source.PATH, input.home, input.exists),
    HOME: input.home,
    LANG: /^[A-Za-z0-9_.@-]{1,40}$/.test(lang) ? lang : "en_US.UTF-8",
    PORT: String(input.port),
    HOST: "127.0.0.1",
    BROWSER: "none",
    NODE_ENV: "development",
  };
}

// Enforces the module boundaries described in skills/jal-architecture:
//   - a module may only reach a sibling module through that sibling's
//     index.ts (never a deep import into its internals)
//   - a module may never import a raw infra client (pg/ioredis/etc); infra
//     always sits behind a port in src/core/
//
// core/** is deliberately NOT scanned: core is where adapters are allowed to
// touch raw infra clients directly, per the ports-and-adapters pattern.
import { Glob } from "bun";

const root = new URL("../apps/api/src/", import.meta.url).pathname;
const files = [...new Glob("modules/**/*.ts").scanSync(root)];

const RAW_INFRA = ["pg", "postgres", "ioredis", "redis", "@aws-sdk/client-s3"];

// The shared lib/* wrappers (apps/api/src/lib/{db,redis,s3,ai}.ts) hold the
// actual raw infra client construction (`new Pool(...)`, `new Redis(...)`,
// etc). core/adapters/*.ts is the one place allowed to import them, wrapping
// each one behind a core/ports/*.ts port. A module that imports lib/* directly
// skips that port entirely, so it is a boundary violation just like importing
// the raw infra package itself (see RAW_INFRA above).
const LIB_WRAPPER_RE = /(?:^|\/)lib\/(db|redis|s3|ai)(?:\.ts)?$/;

const violations: string[] = [];

for (const rel of files) {
  const self = rel.split("/")[1];
  const src = await Bun.file(root + rel).text();
  const importRe = /import[^"']*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(src))) {
    const spec = m[1];

    // A one-level-up relative import ("../<name>/...") reaches into a
    // sibling folder under modules/. A two-or-more-level-up import
    // ("../../core/...", "../../lib/...") escapes modules/ entirely and is
    // not a sibling-module reference, so it is deliberately excluded here
    // via the negative lookahead.
    const sib = spec.match(/^\.\.\/(?!\.\.\/)([^/]+)(\/.*)?$/);
    if (sib && sib[1] !== self && sib[2] && !/^\/index(\.ts)?$/.test(sib[2])) {
      violations.push(`${rel}: deep import into sibling module "${sib[1]}" (${spec})`);
    }

    // Catches any import spec that names another module's internals by
    // path, however it got there (alias, absolute, workspace-relative).
    const deep = spec.match(/modules\/([^/]+)\/(.+)$/);
    if (deep && deep[1] !== self && !/^index(\.ts)?$/.test(deep[2])) {
      violations.push(`${rel}: deep import into module "${deep[1]}" (${spec})`);
    }

    if (RAW_INFRA.includes(spec)) {
      violations.push(`${rel}: raw infra import "${spec}"; use a core port instead`);
    }

    if (LIB_WRAPPER_RE.test(spec)) {
      violations.push(`${rel}: direct import of shared lib wrapper "${spec}"; use a core port instead`);
    }
  }
}

if (violations.length > 0) {
  console.error("BOUNDARY CHECK FAIL:\n" + violations.join("\n"));
  process.exit(1);
}

console.log("BOUNDARY CHECK PASS");

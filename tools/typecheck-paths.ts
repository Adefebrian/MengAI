// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Scoped typecheck for parallel workstreams: runs tsc on one project and
// fails only on errors inside the owned paths (regex). Other workstreams'
// half-built files never block this one.
//
//   bun tools/typecheck-paths.ts apps/api 'modules/(providers|usage)/|adapters/(llm|media)'
import { resolve } from "node:path";

const [project, pattern] = process.argv.slice(2);
if (!project || !pattern) {
  console.error("usage: bun tools/typecheck-paths.ts <project dir> <path regex>");
  process.exit(2);
}

const root = resolve(import.meta.dir, "..");
const proc = Bun.spawnSync(["bunx", "tsc", "--noEmit", "-p", resolve(root, project)], { cwd: root });
const out = proc.stdout.toString() + proc.stderr.toString();
const errors = out.split("\n").filter((line) => /error TS\d+/.test(line));
const re = new RegExp(pattern);
const owned = errors.filter((line) => re.test(line));

console.log(`${owned.length} type errors in owned paths (${errors.length} in ${project} overall)`);
for (const line of owned) console.log(line);
process.exit(owned.length > 0 ? 1 : 0);

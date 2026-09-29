// Configuration review: Dockerfiles, compose files, CORS wildcards, cookies
// without HttpOnly, debug flags and .env files that git does not ignore.
// Line-based heuristics on purpose (no YAML or AST dependency); each rule
// reports the first line it can point at and masks any secret value.
import { redact } from "../../lib/redact";
import { baseName, ephemeralTag, extName, isPlaceholder, isSecretName, maskSecret, normalizeLine, type RawFinding, type ValueTag } from "./util";

type Out = RawFinding[];

function cfg(rule: string, title: string, severity: RawFinding["severity"], file: string, line: number | null, detail: string, fix: string, key: string): RawFinding {
  return { kind: "config", rule, title, severity, file, line, detail: redact(detail), fix, key: redact(key) };
}

// ------------------------------------------------------------- Dockerfile
export function isDockerfile(path: string): boolean {
  const n = baseName(path);
  return n === "Dockerfile" || n === "Containerfile" || n.startsWith("Dockerfile.") || n.endsWith(".Dockerfile") || n.endsWith(".dockerfile");
}

interface Instruction {
  op: string;
  args: string;
  line: number;
}

function dockerInstructions(text: string): Instruction[] {
  const out: Instruction[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    let raw = lines[i]!.replace(/\r$/, "");
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    const start = i + 1;
    while (raw.trimEnd().endsWith("\\") && i + 1 < lines.length) {
      raw = raw.trimEnd().slice(0, -1) + " " + lines[++i]!.replace(/\r$/, "").trim();
    }
    const m = /^\s*([A-Za-z]+)\s+(.*)$/.exec(raw);
    if (m) out.push({ op: m[1]!.toUpperCase(), args: m[2]!.trim(), line: start });
  }
  return out;
}

function envPairs(args: string): Array<{ name: string; value: string }> {
  // ENV A=1 B="two words"  |  legacy ENV A value  |  ARG A=default
  const pairs: Array<{ name: string; value: string }> = [];
  const re = /([A-Za-z_][A-Za-z0-9_]*)=("(?:[^"\\]|\\.)*"|'[^']*'|\S*)/g;
  let found = false;
  for (let m = re.exec(args); m; m = re.exec(args)) {
    found = true;
    pairs.push({ name: m[1]!, value: m[2]!.replace(/^["']|["']$/g, "") });
  }
  if (!found) {
    const legacy = /^([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/.exec(args);
    if (legacy) pairs.push({ name: legacy[1]!, value: legacy[2]!.trim().replace(/^["']|["']$/g, "") });
  }
  return pairs;
}

export function reviewDockerfile(file: string, text: string, opts: { tag?: ValueTag } = {}): Out {
  const valueTag = opts.tag ?? ephemeralTag;
  const out: Out = [];
  const ins = dockerInstructions(text);
  const stages = new Set<string>();
  let lastFrom: Instruction | null = null;
  let lastUser: Instruction | null = null;
  for (const i of ins) {
    if (i.op === "FROM") {
      lastFrom = i;
      lastUser = null;
      const parts = i.args.split(/\s+/).filter((p) => !p.startsWith("--"));
      const image = parts[0] ?? "";
      const alias = parts[1]?.toUpperCase() === "AS" ? parts[2] : undefined;
      if (image && image !== "scratch" && !stages.has(image.toLowerCase()) && !image.includes("$")) {
        const lastSeg = image.slice(image.lastIndexOf("/") + 1);
        const tag = lastSeg.includes(":") ? lastSeg.slice(lastSeg.indexOf(":") + 1) : null;
        if (!image.includes("@sha256:") && (!tag || tag === "latest")) {
          out.push(cfg("docker.unpinned_base", "Base image is not pinned", "low", file, i.line,
            `FROM ${image} resolves to whatever the registry serves today; builds are not reproducible and a compromised tag ships silently.`,
            "Pin a version tag and preferably a digest, for example image:1.2.3@sha256:<digest>.", `from ${image}`));
        }
      }
      if (alias) stages.add(alias.toLowerCase());
      continue;
    }
    if (i.op === "USER") lastUser = i;
    if (i.op === "ENV" || i.op === "ARG") {
      for (const { name, value } of envPairs(i.args)) {
        if (!isSecretName(name) || !value || value.startsWith("$") || isPlaceholder(value)) continue;
        out.push(cfg("docker.secret_in_env", `Secret baked into the image via ${i.op} ${name}`, "high", file, i.line,
          `${i.op} ${name} is set to a literal value ${maskSecret(value)}; it is stored in the image layers and visible to anyone who can pull the image.`,
          "Remove the value, rotate it, and pass it at runtime (env injection or a build secret mount).", `${i.op.toLowerCase()} ${name}|${valueTag(value)}`));
      }
    }
  }
  if (lastFrom) {
    const user = lastUser?.args.split(/\s+/)[0]?.toLowerCase() ?? null;
    if (user === null || user === "root" || user === "0" || user.startsWith("0:") || user.startsWith("root:")) {
      out.push(cfg("docker.root_user", "Container runs as root", "medium", file, lastUser?.line ?? lastFrom.line,
        user === null ? "The final stage never sets USER, so the process runs as root inside the container." : `The final stage sets USER ${user}.`,
        "Add a non-root user and switch to it with USER in the final stage.", "root user"));
    }
  }
  return out;
}

// ---------------------------------------------------------------- compose
export function isComposeFile(path: string): boolean {
  return /^(docker-)?compose(\.[\w-]+)?\.ya?ml$/i.test(baseName(path));
}

const DB_PORTS = new Map<number, string>([
  [5432, "PostgreSQL"], [5433, "PostgreSQL"], [3306, "MySQL"], [1433, "SQL Server"], [1521, "Oracle"], [27017, "MongoDB"], [27018, "MongoDB"],
  [6379, "Redis"], [9200, "Elasticsearch"], [9300, "Elasticsearch"], [5984, "CouchDB"], [8086, "InfluxDB"], [9042, "Cassandra"],
  [26257, "CockroachDB"], [11211, "Memcached"], [7687, "Neo4j"], [8529, "ArangoDB"], [28015, "RethinkDB"],
]);
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function unquote(s: string): string {
  return s.trim().replace(/^["']|["']$/g, "");
}

function checkPort(file: string, line: number, spec: { hostIp?: string; published?: string; target?: string }, out: Out): void {
  if (!spec.published || !spec.target) return;
  if (spec.hostIp && LOOPBACK.has(spec.hostIp)) return;
  const target = Number(spec.target.split("-")[0]);
  const db = DB_PORTS.get(target);
  if (!db) return;
  out.push(cfg("compose.db_port_published", `${db} port ${target} published on all host interfaces`, "medium", file, line,
    `The ${db} container port ${target} is mapped to host port ${spec.published} without a loopback bind, so it is reachable from the network the host sits on.`,
    `Drop the ports mapping and reach the database over the compose network, or bind it to loopback: "127.0.0.1:${spec.published}:${target}".`, `port ${spec.published}:${target}`));
}

function parseShortPort(raw: string): { hostIp?: string; published?: string; target?: string } {
  const v = unquote(raw).replace(/\/(tcp|udp)$/i, "");
  const ipv6 = /^\[([^\]]+)\]:(.+)$/.exec(v);
  if (ipv6) {
    const rest = ipv6[2]!.split(":");
    return rest.length === 2 ? { hostIp: `[${ipv6[1]}]`, published: rest[0], target: rest[1] } : {};
  }
  const parts = v.split(":");
  if (parts.length === 3) return { hostIp: parts[0], published: parts[1], target: parts[2] };
  if (parts.length === 2) return { published: parts[0], target: parts[1] };
  return {};
}

export function reviewCompose(file: string, text: string, opts: { tag?: ValueTag } = {}): Out {
  const valueTag = opts.tag ?? ephemeralTag;
  const out: Out = [];
  const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const block = /^(\s*)(ports|environment):\s*$/.exec(line);
    if (!block) continue;
    const baseIndent = block[1]!.length;
    const kind = block[2]!;
    let j = i + 1;
    let item: { line: number; hostIp?: string; published?: string; target?: string } | null = null;
    const flush = () => {
      if (item) checkPort(file, item.line, item, out);
      item = null;
    };
    for (; j < lines.length; j++) {
      const l = lines[j]!;
      if (!l.trim() || l.trimStart().startsWith("#")) continue;
      if (indentOf(l) <= baseIndent) break;
      const t = l.trim();
      if (kind === "ports") {
        if (t.startsWith("- ")) {
          flush();
          const body = t.slice(2).trim();
          const kv = /^([a-z_]+):\s*(.+)$/.exec(body);
          if (kv) {
            item = { line: j + 1 };
            assignPortKey(item, kv[1]!, kv[2]!);
          } else {
            checkPort(file, j + 1, parseShortPort(body), out);
          }
        } else if (item) {
          const kv = /^([a-z_]+):\s*(.+)$/.exec(t);
          if (kv) assignPortKey(item, kv[1]!, kv[2]!);
        }
        continue;
      }
      // environment: list form "- KEY=value" or map form "KEY: value"
      const pair = t.startsWith("- ") ? /^-\s+["']?([A-Za-z_][A-Za-z0-9_]*)=(.*?)["']?$/.exec(t) : /^["']?([A-Za-z_][A-Za-z0-9_]*)["']?:\s*(.*)$/.exec(t);
      if (!pair) continue;
      const name = pair[1]!;
      const value = unquote(pair[2] ?? "");
      if (!isSecretName(name) || !value || value.includes("$") || isPlaceholder(value)) continue;
      out.push(cfg("compose.inline_secret", `Secret ${name} written inline in the compose file`, "high", file, j + 1,
        `${name} is set to a literal value ${maskSecret(value)} in the compose file, which is usually committed.`,
        "Reference it as ${" + name + "} from an untracked .env file or use compose secrets, and rotate the exposed value.", `env ${name}|${valueTag(value)}`));
    }
    flush();
    i = j - 1;
  }
  return out;
}

function assignPortKey(item: { hostIp?: string; published?: string; target?: string }, key: string, raw: string): void {
  const v = unquote(raw);
  if (key === "target") item.target = v;
  else if (key === "published") item.published = v;
  else if (key === "host_ip") item.hostIp = v;
}

// ----------------------------------------------- source and config text
const CODE_EXT = new Set(["js", "mjs", "cjs", "ts", "tsx", "jsx", "mts", "cts", "py", "go", "rb", "php", "java", "kt", "cs", "rs", "conf", "yaml", "yml", "toml", "ini", "json", "env", "properties", "vue", "svelte"]);

export function isReviewableSource(path: string): boolean {
  const name = baseName(path);
  if (/\.min\.js$/.test(name) || name.endsWith(".d.ts")) return false;
  return CODE_EXT.has(extName(path)) || /^\.env(\..+)?$/.test(name) || name === "nginx.conf";
}

interface LineRule {
  rule: string;
  title: string;
  severity: RawFinding["severity"];
  re: RegExp;
  detail: string;
  fix: string;
  /** only run when the whole file matches this */
  when?: RegExp;
}

const LINE_RULES: LineRule[] = [
  {
    rule: "cors.wildcard_origin",
    title: "CORS allows any origin",
    severity: "medium",
    re: /Access-Control-Allow-Origin["']?\s*[,:=]?\s*["']?\*|\borigin\s*:\s*["'`]\*["'`]|allow_origins\s*=\s*\[\s*["']\*["']\s*\]|CORS_(?:ALLOW_ALL_ORIGINS|ORIGIN_ALLOW_ALL)\s*=\s*True|AllowAllOrigins\s*:\s*true|Allow(?:ed)?Origins\s*:\s*\[\]string\{\s*"\*"|allowedOrigins\(\s*"\*"\s*\)|@CrossOrigin\(\s*(?:origins\s*=\s*)?"\*"/,
    detail: "Any website can read responses from this API in the visitor's browser.",
    fix: "Replace the wildcard with an exact-match allowlist of trusted origins loaded from config.",
  },
  {
    rule: "cors.reflect_any_origin",
    title: "CORS reflects every origin",
    severity: "medium",
    re: /\borigin\s*:\s*true\b|\bCORS\(\s*app\s*\)/,
    when: /cors/i,
    detail: "The CORS setup echoes back whatever Origin the browser sends, which is equivalent to a wildcard and also works with credentials.",
    fix: "Pass an explicit origin allowlist instead of true or the library default.",
  },
  {
    rule: "cookie.no_httponly",
    title: "Cookie without HttpOnly",
    severity: "medium",
    re: /\bhttp_?only["']?\s*[:=]\s*(?:false|False|FALSE)\b|SESSION_COOKIE_HTTPONLY\s*=\s*False/i,
    detail: "The cookie is readable from JavaScript, so any XSS can steal the session.",
    fix: "Set HttpOnly (plus Secure and SameSite) on session and auth cookies.",
  },
  {
    rule: "config.debug_enabled",
    title: "Debug mode enabled",
    severity: "medium",
    re: /^\s*DEBUG\s*=\s*True\b|\.run\([^)]*debug\s*=\s*True|\b(?:FLASK_DEBUG|APP_DEBUG|DJANGO_DEBUG)\s*[=:]\s*["']?(?:1|true)\b|\bapp\.debug\s*=\s*true\b|gin\.SetMode\(\s*gin\.DebugMode\s*\)/i,
    detail: "Debug mode exposes stack traces, settings and sometimes an interactive console to anyone who triggers an error.",
    fix: "Drive debug from an environment variable that defaults to off, and keep it off in production images.",
  },
];

const SET_COOKIE_STRING = /["'`]Set-Cookie["'`]\s*,\s*["'`]([^"'`]{3,})["'`]/i;
const COOKIE_CALL = /\b(?:res|reply|response|resp|c|ctx)\.cookie\s*\(|\bsetCookie\s*\(/g;

function callText(text: string, start: number): string {
  let depth = 0;
  const end = Math.min(text.length, start + 800);
  for (let k = start; k < end; k++) {
    const ch = text[k];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return text.slice(start, k + 1);
    }
  }
  return text.slice(start, end);
}

export function reviewSource(file: string, text: string): Out {
  const out: Out = [];
  const lines = text.split("\n");
  const seen = new Set<string>();
  const push = (f: RawFinding) => {
    const k = `${f.rule}:${f.line}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(f);
    }
  };
  for (const r of LINE_RULES) {
    if (r.when && !r.when.test(text)) continue;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.length > 2000 || !r.re.test(line)) continue;
      push(cfg(r.rule, r.title, r.severity, file, i + 1, `${r.detail} (${file}:${i + 1})`, r.fix, normalizeLine(line)));
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const m = SET_COOKIE_STRING.exec(lines[i]!);
    if (m && !/httponly/i.test(m[1]!)) {
      push(cfg("cookie.no_httponly", "Cookie without HttpOnly", "medium", file, i + 1,
        `A Set-Cookie header is built without the HttpOnly attribute (${file}:${i + 1}).`,
        "Add HttpOnly; Secure; SameSite=Lax (or Strict) to the header.", normalizeLine(lines[i]!)));
    }
  }
  COOKIE_CALL.lastIndex = 0;
  for (let m = COOKIE_CALL.exec(text); m; m = COOKIE_CALL.exec(text)) {
    const call = callText(text, m.index + m[0].length - 1);
    if (/http_?only/i.test(call)) continue;
    const line = text.slice(0, m.index).split("\n").length;
    push(cfg("cookie.no_httponly", "Cookie without HttpOnly", "medium", file, line,
      `A cookie is set without an httpOnly option (${file}:${line}); most frameworks default it to off.`,
      "Pass { httpOnly: true, secure: true, sameSite: \"Lax\" } for session and auth cookies.", normalizeLine(lines[line - 1] ?? "")));
  }
  return out;
}

// ------------------------------------------------------ .env not ignored
export function isEnvFile(path: string): boolean {
  const name = baseName(path);
  if (!/^\.env(\..+)?$/.test(name)) return false;
  return !/\.(example|sample|template|dist|defaults|schema)$/i.test(name);
}

interface IgnoreRule {
  re: RegExp;
  negate: boolean;
  dirOnly: boolean;
}

function globToRegex(glob: string): string {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else re += "[^/]*";
    } else if (ch === "?") re += "[^/]";
    else if (ch === "[") {
      const close = glob.indexOf("]", i + 1);
      if (close > i) {
        re += "[" + glob.slice(i + 1, close).replace(/^!/, "^").replace(/\\/g, "\\\\") + "]";
        i = close;
      } else re += "\\[";
    } else if (ch === "\\" && i + 1 < glob.length) {
      re += "\\" + glob[++i];
    } else re += /[.+^${}()|\]\\]/.test(ch) ? "\\" + ch : ch;
  }
  return re;
}

export function parseGitignore(text: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const raw of text.split("\n")) {
    let p = raw.replace(/\r$/, "").replace(/(?<!\\)\s+$/, "");
    if (!p || p.startsWith("#")) continue;
    const negate = p.startsWith("!");
    if (negate) p = p.slice(1);
    const dirOnly = p.endsWith("/");
    if (dirOnly) p = p.slice(0, -1);
    const anchored = p.includes("/");
    if (p.startsWith("/")) p = p.slice(1);
    if (!p) continue;
    const body = globToRegex(p);
    rules.push({ re: new RegExp(anchored ? `^${body}$` : `^(?:.*/)?${body}$`), negate, dirOnly });
  }
  return rules;
}

/**
 * Git ignore check for one file. `ignores` lists .gitignore files from the
 * root down (base is the folder holding each one, "" for the root).
 */
export function isIgnored(path: string, ignores: Array<{ base: string; rules: IgnoreRule[] }>): boolean {
  let ignored = false;
  for (const { base, rules } of ignores) {
    const prefix = base ? `${base}/` : "";
    if (prefix && !path.startsWith(prefix)) continue;
    const rel = path.slice(prefix.length);
    const segs = rel.split("/");
    const candidates: Array<{ p: string; dir: boolean }> = [];
    for (let k = 1; k < segs.length; k++) candidates.push({ p: segs.slice(0, k).join("/"), dir: true });
    candidates.push({ p: rel, dir: false });
    for (const r of rules) {
      if (candidates.some((c) => (c.dir || !r.dirOnly) && r.re.test(c.p))) ignored = !r.negate;
    }
  }
  return ignored;
}

export function envNotIgnoredFinding(file: string): RawFinding {
  return cfg("env.not_ignored", `${baseName(file)} is not ignored by git`, "high", file, null,
    `${file} holds environment values but no .gitignore rule covers it, so it is easy to commit (or already committed).`,
    "Add it to .gitignore (for example `.env*` plus `!.env.example`), rotate any secrets it held, and purge it from history if it was committed.", "env not ignored");
}

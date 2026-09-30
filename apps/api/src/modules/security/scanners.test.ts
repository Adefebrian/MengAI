// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Pure scanner tests: lockfile parsers, secret rules and masking, config
// rules, gitignore matching, CVSS scoring. Secret-shaped fixtures are built
// by concatenation so no credential pattern is ever committed literally.
import { describe, expect, test } from "bun:test";
import { isIgnored, parseGitignore, reviewCompose, reviewDockerfile, reviewSource, isEnvFile } from "./config";
import {
  parseBunLock,
  parseCargoLock,
  parseGoSum,
  parseLockfile,
  parsePackageLock,
  parsePnpmLock,
  parsePoetryLock,
  parseRequirements,
  parseYarnLock,
} from "./lockfiles";
import { compareVersions, cvss3Score, vulnSeverity } from "./osv";
import { scanSecrets } from "./secrets";
import { entropy, hmacTag, isPlaceholder, isTestPath, longestSequentialRun, maskSecret } from "./util";

const pairs = (xs: Array<{ name: string; version: string }>) => xs.map((p) => `${p.name}@${p.version}`).sort();

describe("lockfile parsers", () => {
  test("bun.lock (jsonc, trailing commas, workspace entries skipped)", () => {
    const text = `{
  "lockfileVersion": 1,
  "workspaces": { "": { "name": "demo", "dependencies": { "lodash": "^4.17.20", }, }, },
  "packages": {
    "lodash": ["lodash@4.17.20", "", {}, "sha512-abc"],
    "@types/node": ["@types/node@20.1.0", "", { "dependencies": {} }, "sha512-def"],
    // local workspace package
    "demo-lib": ["demo-lib@workspace:packages/lib"],
    "gh": ["gh@github:user/repo#abc123", {}],
  },
}`;
    expect(pairs(parseBunLock(text))).toEqual(["@types/node@20.1.0", "lodash@4.17.20"]);
  });

  test("package-lock.json v3 and v1", () => {
    const v3 = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { name: "x" },
        "node_modules/express": { version: "4.17.1" },
        "node_modules/express/node_modules/debug": { version: "2.6.9" },
        "node_modules/local": { resolved: "packages/local", link: true },
        "packages/local": { version: "1.0.0" },
        "node_modules/aliased": { name: "real-pkg", version: "3.0.0" },
      },
    });
    expect(pairs(parsePackageLock(v3))).toEqual(["debug@2.6.9", "express@4.17.1", "real-pkg@3.0.0"]);
    const v1 = JSON.stringify({ lockfileVersion: 1, dependencies: { minimist: { version: "0.0.8", dependencies: { ms: { version: "2.0.0" } } } } });
    expect(pairs(parsePackageLock(v1))).toEqual(["minimist@0.0.8", "ms@2.0.0"]);
    expect(parsePackageLock("{ not json")).toEqual([]);
  });

  test("pnpm-lock.yaml v9, v6 and v5 keys", () => {
    const v9 = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      lodash:
        specifier: ^4.17.20
        version: 4.17.20

packages:

  '@babel/core@7.24.0':
    resolution: {integrity: sha512-x}

  lodash@4.17.20:
    resolution: {integrity: sha512-y}

snapshots:

  lodash@4.17.20: {}
`;
    expect(pairs(parsePnpmLock(v9))).toEqual(["@babel/core@7.24.0", "lodash@4.17.20"]);
    const old = `lockfileVersion: 5.4
packages:
  /@babel/core/7.12.3_supports-color@5.5.0:
    resolution: {integrity: sha512-a}
  /ms/2.1.2:
    resolution: {integrity: sha512-b}
  /react-dom@18.2.0(react@18.2.0):
    resolution: {integrity: sha512-c}
`;
    expect(pairs(parsePnpmLock(old))).toEqual(["@babel/core@7.12.3", "ms@2.1.2", "react-dom@18.2.0"]);
  });

  test("yarn.lock v1 and berry", () => {
    const v1 = `# yarn lockfile v1


"@babel/code-frame@^7.0.0", "@babel/code-frame@^7.10.4":
  version "7.12.13"
  resolved "https://registry.yarnpkg.com/x"

lodash@^4.17.15:
  version "4.17.21"
`;
    expect(pairs(parseYarnLock(v1))).toEqual(["@babel/code-frame@7.12.13", "lodash@4.17.21"]);
    const berry = `__metadata:
  version: 6

"lodash@npm:^4.17.21":
  version: 4.17.21
  resolution: "lodash@npm:4.17.21"

"demo@workspace:.":
  version: 0.0.0-use.local
`;
    expect(pairs(parseYarnLock(berry))).toEqual(["lodash@4.17.21"]);
  });

  test("requirements.txt and poetry.lock normalize names", () => {
    const req = `# comment
Django==3.2.0
requests[security] == 2.25.1  # pinned
flask>=2.0
-r other.txt
urllib3==1.26.4 \\
    --hash=sha256:abc
Jinja2===2.11.2
`;
    expect(pairs(parseRequirements(req))).toEqual(["django@3.2.0", "jinja2@2.11.2", "requests@2.25.1", "urllib3@1.26.4"]);
    const poetry = `[[package]]
name = "Django"
version = "3.2.0"
description = "x"

[package.dependencies]
asgiref = ">=3.3.2"

[[package]]
name = "PyYAML"
version = "5.3.1"
`;
    expect(pairs(parsePoetryLock(poetry))).toEqual(["django@3.2.0", "pyyaml@5.3.1"]);
  });

  test("go.sum strips the v prefix and dedupes go.mod lines", () => {
    const sum = `github.com/gin-gonic/gin v1.6.3 h1:abc=
github.com/gin-gonic/gin v1.6.3/go.mod h1:def=
golang.org/x/net v0.0.0-20210405180319-a5a99cb37ef4 h1:x=
`;
    expect(parseGoSum(sum)).toHaveLength(3);
    const refs = parseLockfile("svc/go.sum", sum);
    expect(pairs(refs)).toEqual(["github.com/gin-gonic/gin@1.6.3", "golang.org/x/net@0.0.0-20210405180319-a5a99cb37ef4"]);
    expect(refs[0]!.ecosystem).toBe("Go");
    expect(refs[0]!.file).toBe("svc/go.sum");
  });

  test("Cargo.lock keeps registry crates only", () => {
    const cargo = `version = 3

[[package]]
name = "demo"
version = "0.1.0"

[[package]]
name = "smallvec"
version = "1.6.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "abc"

[[package]]
name = "gitdep"
version = "0.2.0"
source = "git+https://github.com/x/y#abc"
`;
    expect(pairs(parseCargoLock(cargo))).toEqual(["smallvec@1.6.0"]);
    expect(parseLockfile("Cargo.lock", cargo)[0]!.ecosystem).toBe("crates.io");
  });
});

describe("secret detection and masking", () => {
  const aws = "AKIA" + "Q7X2M9P4L6K3J8H5";
  const gh = "ghp" + "_" + "A1b2C3d4E5f6G7h8".repeat(3);
  const pw = "Zq8" + "vLm2Rt5Wx9Kp3Nb";

  test("provider-shaped and generic secrets are found and masked", () => {
    const text = [`const id = "${aws}";`, `token: ${gh}`, `DB_PASSWORD="${pw}"`, `const apiKey = process.env.API_KEY;`, `password: "changeme-placeholder"`].join("\n");
    const found = scanSecrets("src/config.ts", text);
    expect(found.map((f) => f.rule).sort()).toEqual(["secret.aws_access_key_id", "secret.generic_assignment", "secret.github_token"]);
    for (const f of found) {
      expect(f.kind).toBe("secrets");
      expect(f.file).toBe("src/config.ts");
      for (const raw of [aws, gh, pw]) {
        expect(f.detail).not.toContain(raw);
        expect(f.detail).not.toContain(raw.slice(4, 12));
        expect(f.key).not.toContain(raw);
      }
    }
    expect(found.find((f) => f.rule === "secret.github_token")!.line).toBe(2);
    expect(found.find((f) => f.rule === "secret.github_token")!.severity).toBe("critical");
  });

  test("maskSecret keeps at most 4 leading characters and never the tail", () => {
    const v = "abcd" + "efghijklmnopqrstuvwxyz";
    const m = maskSecret(v);
    expect(m.startsWith("abcd********")).toBe(true);
    expect(m).not.toContain("wxyz");
    expect(maskSecret("short-secret1")).toBe("sh******** (13 chars)");
    expect(maskSecret("tiny1234")).toBe("******** (8 chars)");
  });

  test("low entropy and code references are not flagged", () => {
    const text = [`password = "aaaaaaaaaaaaaaaa"`, `secret: settings.secretValue`, `token = getToken(user)`].join("\n");
    expect(scanSecrets("a.py", text)).toEqual([]);
    expect(entropy("aaaa")).toBe(0);
  });

  test("code references, regexes, constants and identifiers are not secrets", () => {
    const text = [
      `const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD/i;`,
      `maxOutputTokens: OUTPUT_CAP[a.dto.role],`,
      `const tokenBudget = MIN_TOKEN_BUDGET_X;`,
      `POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:?set it}`,
      `export const CONTROL_TOKEN_HEADER = "x-mengai-control";`,
    ].join("\n");
    expect(scanSecrets("src/lib.ts", text)).toEqual([]);
  });

  test("connection strings: loopback is low, documentation defaults are skipped", () => {
    const local = scanSecrets("tools/migrate.ts", `const url = "postgres://app:Xy7" + "Kq29Lm4@localhost:5432/app";`.replace('" + "', ""));
    expect(local.map((f) => [f.rule, f.severity, f.status])).toEqual([["secret.connection_string", "low", "false_positive"]]);
    expect(local[0]!.detail).toContain("Closed as a false positive: the host is loopback");
    const remote = scanSecrets("src/db.ts", `DATABASE_URL=postgres://app:Xy7Kq29Lm4@db.internal.example.net:5432/app`);
    expect(remote.map((f) => [f.rule, f.severity, f.status])).toEqual([["secret.connection_string", "high", undefined]]);
    expect(scanSecrets(".env.example", "# postgres://user:password@host:5432/db")).toEqual([]);
  });

  test("secrets in test paths are reported from a low default", () => {
    const gh = "ghp" + "_" + "A1b2C3d4E5f6G7h8".repeat(3);
    for (const path of ["src/auth.test.ts", "tests/fixtures/keys.json", "pkg/client_test.go", "test_api.py"]) {
      const [f] = scanSecrets(path, `token = "${gh}"`);
      expect(f!.severity).toBe("low");
      expect(f!.title).toContain("(test path)");
      expect(f!.detail).toContain("likely a fixture");
    }
    expect(scanSecrets("src/auth.ts", `token = "${gh}"`)[0]!.severity).toBe("critical");
  });

  test("sequential-alphabet fixtures are placeholders, random keys are not", () => {
    const fixture = "sk-" + "proj-" + "ABCDEFGHIJKLMNOPQRST";
    expect(scanSecrets("src-tauri/src/applog.rs", `let k = "${fixture}";`)).toEqual([]);
    expect(isPlaceholder("x" + "12345678" + "y")).toBe(true);
    expect(isPlaceholder("zyxwvut" + "9Qk2")).toBe(false);
    expect(isPlaceholder("zyxwvuts" + "9Qk2")).toBe(true);
    expect(longestSequentialRun("abcd1234efgh")).toBe(4);
    const live = "sk-" + "proj-" + "Q1w2E3r4T5y6U7i8O9p0";
    expect(scanSecrets("src/ai.ts", `const k = "${live}";`).map((f) => f.rule)).toEqual(["secret.openai_key"]);
  });

  test("fingerprint keys carry a keyed tag of the value, never the value", () => {
    const tag = hmacTag("k".repeat(64));
    const a = "Zq8" + "vLm2Rt5Wx9Kp3Nb";
    const b = "Hy4" + "cTn7Qe1Ud6Rf0Zs";
    const [fa] = scanSecrets("app.py", `password = "${a}"`, { tag });
    const [fa2] = scanSecrets("app.py", `password = "${a}"`, { tag });
    const [fb] = scanSecrets("app.py", `password = "${b}"`, { tag });
    expect(fa!.key).toBe(fa2!.key);
    expect(fa!.key).not.toBe(fb!.key);
    expect(fa!.key).not.toContain(a);
    expect(fa!.key.endsWith(`|${tag(a)}`)).toBe(true);
    // another install key gives another tag for the same value
    expect(hmacTag("j".repeat(64))(a)).not.toBe(tag(a));
    const header = "-----BEGIN " + "RSA PRIVATE KEY-----";
    const [p1] = scanSecrets("id_rsa", `${header}\nMIIEone\n-----END RSA PRIVATE KEY-----`, { tag });
    const [p2] = scanSecrets("id_rsa", `${header}\nMIIEtwo\n-----END RSA PRIVATE KEY-----`, { tag });
    expect(p1!.key).not.toBe(p2!.key);
    const d1 = reviewDockerfile("Dockerfile", `FROM node:22\nUSER app\nENV API_TOKEN=${a}\n`, { tag });
    const d2 = reviewDockerfile("Dockerfile", `FROM node:22\nUSER app\nENV API_TOKEN=${b}\n`, { tag });
    expect(d1[0]!.rule).toBe("docker.secret_in_env");
    expect(d1[0]!.key).not.toBe(d2[0]!.key);
    const c1 = reviewCompose("compose.yaml", `services:\n  app:\n    environment:\n      API_TOKEN: ${a}\n`, { tag });
    const c2 = reviewCompose("compose.yaml", `services:\n  app:\n    environment:\n      API_TOKEN: ${b}\n`, { tag });
    expect(c1[0]!.rule).toBe("compose.inline_secret");
    expect(c1[0]!.key).not.toBe(c2[0]!.key);
  });

  test("private key header is critical", () => {
    const f = scanSecrets("id_rsa", "-----BEGIN " + "RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----");
    expect(f).toHaveLength(1);
    expect(f[0]!.rule).toBe("secret.private_key");
    expect(f[0]!.severity).toBe("critical");
  });
});

describe("config rules", () => {
  test("Dockerfile: root user, unpinned base, secret in ENV", () => {
    const f = reviewDockerfile("Dockerfile", `FROM node\nENV API_TOKEN=abcd1234efgh5678ijkl NODE_ENV=production\nRUN npm ci\n`);
    expect(f.map((x) => x.rule).sort()).toEqual(["docker.root_user", "docker.secret_in_env", "docker.unpinned_base"]);
    const secret = f.find((x) => x.rule === "docker.secret_in_env")!;
    expect(secret.detail).not.toContain("abcd1234efgh5678ijkl");
    expect(secret.line).toBe(2);
  });

  test("Dockerfile: pinned, non-root, env references are clean", () => {
    const text = `FROM node:20.11-alpine@sha256:0123 AS build
RUN npm ci
FROM build AS test
FROM gcr.io/distroless/nodejs20:nonroot
ARG API_TOKEN
ENV DB_PASSWORD=\${DB_PASSWORD}
USER 1001
`;
    expect(reviewDockerfile("Dockerfile", text)).toEqual([]);
    expect(reviewDockerfile("Dockerfile", "FROM alpine:3.19\nUSER root\n").map((x) => x.rule)).toEqual(["docker.root_user"]);
  });

  test("compose: published database ports and inline secrets", () => {
    const text = `services:
  db:
    image: postgres:16
    ports:
      - "5432:5432"
    environment:
      POSTGRES_PASSWORD: s3cretPassw0rdValue
      POSTGRES_USER: app
  cache:
    image: redis:7
    ports:
      - "127.0.0.1:6379:6379"
  api:
    image: app
    ports:
      - target: 3306
        published: 3306
      - "8080:8080"
    environment:
      - API_KEY=\${API_KEY}
      - SESSION_SECRET=Zx8vQ2mN7pL4kJ9h
`;
    const f = reviewCompose("docker-compose.yml", text);
    const ports = f.filter((x) => x.rule === "compose.db_port_published");
    expect(ports.map((x) => x.line)).toEqual([5, 16]);
    const secrets = f.filter((x) => x.rule === "compose.inline_secret");
    expect(secrets.map((x) => x.title)).toEqual(["Secret POSTGRES_PASSWORD written inline in the compose file", "Secret SESSION_SECRET written inline in the compose file"]);
    for (const s of secrets) {
      expect(s.detail).not.toContain("s3cretPassw0rdValue");
      expect(s.detail).not.toContain("Zx8vQ2mN7pL4kJ9h");
    }
  });

  test("source: CORS wildcard, cookies without HttpOnly, debug flags", () => {
    const ts = [
      `app.use(cors({ origin: "*" }));`,
      `res.cookie("sid", token);`,
      `res.cookie("theme", "dark", { httpOnly: true });`,
      `const opts = { httpOnly: false };`,
      `res.setHeader("Set-Cookie", "sid=abc; Path=/");`,
    ].join("\n");
    const f = reviewSource("src/server.ts", ts);
    expect(f.filter((x) => x.rule === "cors.wildcard_origin").map((x) => x.line)).toEqual([1]);
    expect(f.filter((x) => x.rule === "cookie.no_httponly").map((x) => x.line).sort()).toEqual([2, 4, 5]);
    expect(reviewSource("app/settings.py", "DEBUG = True\n").map((x) => x.rule)).toEqual(["config.debug_enabled"]);
    expect(reviewSource("app/main.py", "app.run(host='0.0.0.0', debug=True)\n").map((x) => x.rule)).toEqual(["config.debug_enabled"]);
    expect(reviewSource("src/ok.ts", `app.use(cors({ origin: ["https://app.example.com"], credentials: true }));\n`)).toEqual([]);
    expect(isTestPath("src/server.test.ts")).toBe(true);
    expect(isTestPath("src/contest/server.ts")).toBe(false);
  });

  test("gitignore matching for .env files", () => {
    const root = [{ base: "", rules: parseGitignore(".env*\n!.env.example\n") }];
    expect(isIgnored(".env", root)).toBe(true);
    expect(isIgnored("apps/x/.env.local", root)).toBe(true);
    expect(isIgnored(".env.example", root)).toBe(false);
    const anchored = [{ base: "", rules: parseGitignore("/config/.env\nsecrets/\n") }];
    expect(isIgnored("config/.env", anchored)).toBe(true);
    expect(isIgnored("other/config/.env", anchored)).toBe(false);
    expect(isIgnored("secrets/.env", anchored)).toBe(true);
    expect(isIgnored(".env", anchored)).toBe(false);
    const nested = [{ base: "", rules: parseGitignore("node_modules\n") }, { base: "apps/api", rules: parseGitignore(".env\n") }];
    expect(isIgnored("apps/api/.env", nested)).toBe(true);
    expect(isIgnored("apps/web/.env", nested)).toBe(false);
    expect(isEnvFile(".env.example")).toBe(false);
    expect(isEnvFile("apps/api/.env.production")).toBe(true);
  });
});

describe("osv grading helpers", () => {
  test("CVSS v3 base scores and labels", () => {
    expect(cvss3Score("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H")).toBe(9.8);
    expect(cvss3Score("CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N")).toBe(6.1);
    expect(cvss3Score("garbage")).toBeNull();
    expect(vulnSeverity({ database_specific: { severity: "MODERATE" } })).toBe("medium");
    expect(vulnSeverity({ severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }] })).toBe("critical");
    expect(vulnSeverity({})).toBe("medium");
    expect(compareVersions("4.17.21", "4.17.20")).toBeGreaterThan(0);
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
  });
});

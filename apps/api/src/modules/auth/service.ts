// Auth rules: owner setup (server, once, SETUP_CODE), login (argon2id via
// Bun.password, 5 per minute per ip), one-time launch tokens (local), one-time
// pairing tokens (local, 1 hour), and session tokens (32 random bytes, stored
// as sha256, 30 day sliding expiry).
//
// Pairing (local-first bridge): the public website only serves the UI. The
// runtime hands out <site>/app#pair=<token>; the page posts the token to
// POST /api/auth/pair and gets a bearer session bound to its origin, and the
// origin joins the persisted paired list (exact, at most 10, removable;
// removing one revokes its sessions). The runtime's own origin is never
// stored: same origin needs no CORS.
// No Hono here: cookies and bearer headers live in http.ts.
import type { Mode, SessionDTO } from "@mengai/shared";
import { HttpError } from "../../lib/http";
import { timingSafeEqualStr, type SessionPrincipal } from "../../core/auth";
import { consumeLimit, isSameHostOrigin, isWebOrigin, TooManyRequestsError } from "../../core/hardening";
import { createMemoryKv } from "../../core/adapters/kv-memory";
import type { Clock } from "../../core/ports/clock";
import type { Kv } from "../../core/ports/kv";
import type { Logger } from "../../core/ports/logger";
import type { AuthRepo } from "./repo";

export const OWNER_ID = "owner";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** sliding refresh is written at most this often per session */
export const SESSION_TOUCH_MS = 10 * 60 * 1000;
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
/** a pairing link works once, within this window */
export const PAIR_TOKEN_TTL_MS = 60 * 60 * 1000;
/** websites one runtime can be paired with at a time */
export const MAX_PAIRED_ORIGINS = 10;
/** unused pairing tokens kept at once; the oldest is dropped beyond this */
export const MAX_PENDING_PAIR_TOKENS = 16;

const ARGON = { algorithm: "argon2id", memoryCost: 19_456, timeCost: 2 } as const;

export interface IssuedSession {
  token: string;
  expiresAt: number;
  principal: SessionPrincipal;
}

export interface ResolvedSession {
  principal: SessionPrincipal;
  /** set when the expiry slid forward and the cookie should be re-sent */
  refreshedExpiresAt: number | null;
}

export interface PairedOrigin {
  origin: string;
  pairedAt: number;
  lastPairedAt: number;
}

export interface PairResult {
  session: IssuedSession;
  origin: string;
  /** false for the runtime's own origin, which is never stored */
  registered: boolean;
}

export interface AuthService {
  readonly mode: Mode;
  /** local mode: mint a one-time launch token for the desktop shell */
  issueLaunchToken(): string;
  launch(token: string, ip: string): Promise<IssuedSession>;
  /** local mode: mint a one-time pairing token for a website (1 hour) */
  issuePairToken(): string;
  /** local mode: exchange a pairing token from `origin` for a bearer session bound to it; host is the request Host */
  pair(input: { token: string; origin: string; host: string }, ip: string): Promise<PairResult>;
  /** loads the paired origins into memory; call once before serving */
  warm(): Promise<void>;
  /** synchronous, from memory (CORS and the Origin check ask on every request) */
  isPairedOrigin(origin: string): boolean;
  listOrigins(): Promise<PairedOrigin[]>;
  /** unpairs the origin and revokes every session bound to it; false when it was not paired */
  removeOrigin(origin: string): Promise<boolean>;
  setup(input: { email: string; password: string; setupCode: string }, ip: string): Promise<IssuedSession>;
  login(input: { email: string; password: string }, ip: string): Promise<IssuedSession>;
  logout(sessionToken: string | null | undefined): Promise<void>;
  resolve(sessionToken: string | null | undefined): Promise<ResolvedSession | null>;
  sessionInfo(principal: SessionPrincipal | null): Promise<SessionDTO>;
}

export interface AuthServiceOptions {
  repo: AuthRepo;
  kv: Kv;
  clock: Clock;
  logger: Logger;
  mode: Mode;
  setupCode: string | null;
  loginPerMinute?: number;
}

const sha256 = (value: string) => new Bun.CryptoHasher("sha256").update(value).digest("hex");

export function randomSessionToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

export function createAuthService(opts: AuthServiceOptions): AuthService {
  const { repo, clock, logger, mode } = opts;
  const loginPerMinute = opts.loginPerMinute ?? 5;
  // used only when the shared kv is down, so auth limits never switch off
  const fallbackKv = createMemoryKv({ maxEntries: 5_000 });
  const launchTokens = new Set<string>();
  // sha256(token) -> expiresAt, insertion ordered (oldest first)
  const pairTokens = new Map<string, number>();
  const pairedOrigins = new Set<string>();
  let originsLoaded: Promise<void> | null = null;
  let hasOwner = false;
  let dummyHash: Promise<string> | null = null;

  async function limit(action: string, ip: string, max: number): Promise<void> {
    const key = `auth:${action}:${ip}`;
    let result;
    try {
      result = await consumeLimit(opts.kv, key, max, 60);
    } catch {
      result = await consumeLimit(fallbackKv, key, max, 60);
    }
    if (!result.allowed) throw new TooManyRequestsError(result.retryAfterSec, "Too many attempts, wait a minute");
  }

  async function issue(userId: string, email: string | null, origin: string | null = null): Promise<IssuedSession> {
    const token = randomSessionToken();
    const now = clock.now();
    const id = clock.id();
    const expiresAt = now + SESSION_TTL_MS;
    await repo.insertSession({ id, userId, tokenHash: sha256(token), createdAt: now, expiresAt, origin });
    return { token, expiresAt, principal: { sessionId: id, userId, email, origin } };
  }

  function loadOrigins(): Promise<void> {
    originsLoaded ??= (async () => {
      for (const row of await repo.listOrigins()) pairedOrigins.add(row.origin);
    })().catch((err) => {
      originsLoaded = null;
      throw err;
    });
    return originsLoaded;
  }

  function prunePairTokens(now: number): void {
    for (const [h, expiresAt] of pairTokens) if (expiresAt <= now) pairTokens.delete(h);
  }

  async function ownerExists(): Promise<boolean> {
    if (hasOwner) return true;
    hasOwner = (await repo.countUsers()) > 0;
    return hasOwner;
  }

  const serverOnly = () => {
    if (mode !== "server") throw new HttpError(404, "not_available", "Not available in local mode");
  };

  return {
    mode,
    issueLaunchToken() {
      if (mode !== "local") throw new Error("launch tokens exist only in local mode");
      const token = randomSessionToken();
      launchTokens.add(sha256(token));
      return token;
    },

    async launch(token, ip) {
      if (mode !== "local") throw new HttpError(404, "not_available", "Not available in server mode");
      await limit("launch", ip, 10);
      const h = TOKEN_RE.test(token) ? sha256(token) : null;
      if (!h || !launchTokens.delete(h)) throw new HttpError(401, "invalid_launch_token", "Launch token is invalid or already used");
      logger.log("info", "desktop session started");
      return issue(OWNER_ID, null);
    },

    issuePairToken() {
      if (mode !== "local") throw new Error("pairing tokens exist only in local mode");
      const now = clock.now();
      prunePairTokens(now);
      while (pairTokens.size >= MAX_PENDING_PAIR_TOKENS) {
        const oldest = pairTokens.keys().next().value;
        if (oldest === undefined) break;
        pairTokens.delete(oldest);
      }
      const token = randomSessionToken();
      pairTokens.set(sha256(token), now + PAIR_TOKEN_TTL_MS);
      return token;
    },

    async pair(input, ip) {
      if (mode !== "local") throw new HttpError(404, "not_available", "Pairing exists only on a local runtime");
      await limit("pair", ip, 10);
      const origin = input.origin;
      if (!isWebOrigin(origin)) throw new HttpError(403, "bad_origin", "Pairing needs an exact http or https Origin");
      const now = clock.now();
      const h = TOKEN_RE.test(input.token) ? sha256(input.token) : null;
      const expiresAt = h ? pairTokens.get(h) : undefined;
      if (!h || expiresAt === undefined || expiresAt <= now) {
        if (h) pairTokens.delete(h);
        throw new HttpError(401, "invalid_pair_token", "Pairing link is invalid, expired or already used");
      }
      const self = isSameHostOrigin(origin, input.host.toLowerCase());
      await loadOrigins();
      // checked before the token is spent, so a full list does not burn the link
      if (!self && !pairedOrigins.has(origin) && pairedOrigins.size >= MAX_PAIRED_ORIGINS) {
        throw new HttpError(409, "origin_limit", `This runtime is paired with ${MAX_PAIRED_ORIGINS} sites already. Remove one first.`);
      }
      if (!pairTokens.delete(h)) throw new HttpError(401, "invalid_pair_token", "Pairing link is invalid, expired or already used");
      if (!self) {
        await repo.upsertOrigin(origin, now);
        pairedOrigins.add(origin);
      }
      logger.log("info", "website paired", { origin, stored: !self });
      return { session: await issue(OWNER_ID, null, origin), origin, registered: !self };
    },

    warm() {
      return loadOrigins();
    },

    isPairedOrigin(origin) {
      return pairedOrigins.has(origin);
    },

    async listOrigins() {
      return (await repo.listOrigins()).map((r) => ({ origin: r.origin, pairedAt: r.createdAt, lastPairedAt: r.lastPairedAt }));
    },

    async removeOrigin(origin) {
      const existed = await repo.deleteOrigin(origin);
      pairedOrigins.delete(origin);
      await repo.deleteSessionsByOrigin(origin);
      if (existed) logger.log("info", "website unpaired", { origin });
      return existed;
    },

    async setup(input, ip) {
      serverOnly();
      await limit("setup", ip, 5);
      if (!opts.setupCode) throw new HttpError(403, "setup_disabled", "Set SETUP_CODE on the server to create the owner account");
      if (await ownerExists()) throw new HttpError(409, "already_setup", "The owner account already exists");
      if (!timingSafeEqualStr(opts.setupCode, input.setupCode)) throw new HttpError(403, "invalid_setup_code", "Setup code is wrong");
      const passHash = await Bun.password.hash(input.password, ARGON);
      try {
        // fixed id: a concurrent second setup fails on the primary key
        await repo.insertUser({ id: OWNER_ID, email: input.email, passHash, createdAt: clock.now() });
      } catch {
        throw new HttpError(409, "already_setup", "The owner account already exists");
      }
      hasOwner = true;
      logger.log("info", "owner account created");
      return issue(OWNER_ID, input.email);
    },

    async login(input, ip) {
      serverOnly();
      await limit("login", ip, loginPerMinute);
      const user = await repo.findUserByEmail(input.email);
      if (!dummyHash) dummyHash = Bun.password.hash(randomSessionToken(), ARGON);
      // verify against a dummy hash for unknown emails so timing does not reveal them
      const ok = await Bun.password.verify(input.password, user?.passHash ?? (await dummyHash));
      if (!user || !ok) {
        logger.log("warn", "login failed", { ip });
        throw new HttpError(401, "invalid_credentials", "Email or password is wrong");
      }
      await repo.deleteExpired(clock.now());
      return issue(user.id, user.email);
    },

    async logout(sessionToken) {
      if (sessionToken && TOKEN_RE.test(sessionToken)) await repo.deleteSessionByHash(sha256(sessionToken));
    },

    async resolve(sessionToken) {
      if (!sessionToken || !TOKEN_RE.test(sessionToken)) return null;
      const row = await repo.findSession(sha256(sessionToken));
      if (!row) return null;
      const now = clock.now();
      if (row.expiresAt <= now) {
        await repo.deleteSessionById(row.id);
        return null;
      }
      // server sessions must belong to an existing account
      if (mode === "server" && !row.email) return null;
      let refreshedExpiresAt: number | null = null;
      if (now - row.lastSeenAt >= SESSION_TOUCH_MS) {
        refreshedExpiresAt = now + SESSION_TTL_MS;
        await repo.touchSession(row.id, now, refreshedExpiresAt);
      }
      return { principal: { sessionId: row.id, userId: row.userId, email: row.email, origin: row.origin }, refreshedExpiresAt };
    },

    async sessionInfo(principal) {
      const needsSetup = mode === "server" ? !(await ownerExists()) : false;
      const dto: SessionDTO = { authenticated: principal !== null, mode, needsSetup };
      if (principal && principal.email) dto.owner = { id: principal.userId, email: principal.email };
      return dto;
    },
  };
}

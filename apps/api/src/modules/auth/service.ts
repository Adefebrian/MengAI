// Auth rules: owner setup (server, once, SETUP_CODE), login (argon2id via
// Bun.password, 5 per minute per ip), one-time launch tokens (local), and
// session tokens (32 random bytes, stored as sha256, 30 day sliding expiry).
// No Hono here: cookies live in http.ts.
import type { Mode, SessionDTO } from "@mengai/shared";
import { HttpError } from "../../lib/http";
import { timingSafeEqualStr, type SessionPrincipal } from "../../core/auth";
import { consumeLimit, TooManyRequestsError } from "../../core/hardening";
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

export interface AuthService {
  readonly mode: Mode;
  /** local mode: mint a one-time launch token for the desktop shell */
  issueLaunchToken(): string;
  launch(token: string, ip: string): Promise<IssuedSession>;
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

  async function issue(userId: string, email: string | null): Promise<IssuedSession> {
    const token = randomSessionToken();
    const now = clock.now();
    const id = clock.id();
    const expiresAt = now + SESSION_TTL_MS;
    await repo.insertSession({ id, userId, tokenHash: sha256(token), createdAt: now, expiresAt });
    return { token, expiresAt, principal: { sessionId: id, userId, email } };
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
      return { principal: { sessionId: row.id, userId: row.userId, email: row.email }, refreshedExpiresAt };
    },

    async sessionInfo(principal) {
      const needsSetup = mode === "server" ? !(await ownerExists()) : false;
      const dto: SessionDTO = { authenticated: principal !== null, mode, needsSetup };
      if (principal && principal.email) dto.owner = { id: principal.userId, email: principal.email };
      return dto;
    },
  };
}

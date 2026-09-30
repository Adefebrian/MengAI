// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The venue desk: trading venues (an exchange or broker MCP server or API),
// the learning pass after each connect, and what execution needs from a
// learned venue (its price tool, its order tool and the arguments in the
// venue's own form).
//
// A venue sits on one connector: created from a TRADING_VENUE_PRESETS entry
// or reused when a connector with the same kind and target exists. Secrets go
// to the connector (the vault; env vars for a stdio server) and never come
// back. Mode flags a preset's server reads (ccxt-mcp sandbox and trading
// tier, Alpaca paper) are not secrets: they ride on the command as an env
// prefix, so a mode change never needs the secrets again.
//
// What the data engineer's learning pass finds becomes crew-wide skills in
// the memory module (role null, "venue <key>: prices|orders|account|limits");
// notes() renders them for every cat whose role may use the venue, one note
// per venue, byte-stable per skill version so the prompt prefix caches.
// Tool errors on a venue become crew lessons; fills record wins and losses.
// Without a crew sandbox (lib/platform.ts) a venue cannot be created or
// switched to live, and one whose preset starts a local MCP server cannot be
// created or enabled; custom HTTP venues and paper venues keep working.
import { TRADING_VENUE_PRESETS, type AgentRole, type ConnectorDTO, type CreateConnectorBody, type CreateTradingVenueBody, type TradingSettings, type TradingVenueDTO, type TradingVenuePreset, type UpdateConnectorBody } from "@mengai/shared";
import type { ModuleContext } from "../../core/module";
import type { Logger } from "../../core/ports/logger";
import { conflict, HttpError, notFound } from "../../lib/http";
import { assertFeature, type PlatformInfo } from "../../lib/platform";
import { clip, redact } from "../../lib/redact";
import { errorMeaning, learnVenue, skillName, skillPrefix, SKILL_TOPICS, venueNote, venueSkills } from "./learn";
import type { TradingVenue, UpdateTradingVenueBody, VenueMemory, VenueNote, VenueSimulator, VenueTool } from "./ports";
import type { TradingRepo, VenueRow } from "./repo";
import { parsePrice, toVenueSymbol, venueArgs, type OrderLike } from "./symbols";

export const VENUE_LIMITS = {
  /** one read while learning or pricing, ms */
  callTimeoutMs: 20_000,
  /** POST .../learn waits this long for the pass, then answers "learning" (the list shows the end), ms */
  learnWaitMs: 20_000,
  /** a venue's notes are rebuilt at most this often per role, ms */
  notesTtlMs: 15_000,
  lessonKeys: 500,
  secretChars: 4000,
  labelChars: 40,
} as const;

const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,63}$/;
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;
const CONNECTOR_LABEL = /^[a-z0-9](?:[a-z0-9-]|_(?!_)){0,23}$/;
const SIM_PRESET = "simulator";

const errText = (e: unknown) => clip(redact(e instanceof Error ? e.message : String(e)), 300);
const invalid = (message: string, code = "invalid_body") => new HttpError(422, code, message);

export function presetOf(id: string): TradingVenuePreset {
  const p = TRADING_VENUE_PRESETS.find((x) => x.id === id);
  if (!p) throw invalid(`preset: ${clip(id, 40)} is not a trading venue preset`, "unknown_preset");
  return p;
}

/**
 * Env flags a preset's server reads for the venue mode. ccxt-mcp: paper keeps
 * its trading tier off (reads only), testnet is its sandbox, live mainnet
 * needs "live" and a per order USD cap (the owner's max order size). Alpaca:
 * paper trading unless live on mainnet.
 */
export function modeEnv(preset: string, mode: "paper" | "live", testnet: boolean, s: Pick<TradingSettings, "maxOrderUsd">): Record<string, string> {
  if (preset === "ccxt-mcp") {
    const env: Record<string, string> = {};
    if (testnet) env.CCXT_MCP_SANDBOX = "true";
    if (mode === "live") {
      if (testnet) env.CCXT_MCP_TRADING = "sandbox";
      else {
        env.CCXT_MCP_TRADING = "live";
        env.CCXT_MCP_MAX_ORDER_VALUE = String(s.maxOrderUsd > 0 ? s.maxOrderUsd : 0);
      }
    }
    return env;
  }
  if (preset === "alpaca-mcp") return { ALPACA_PAPER_TRADE: mode === "live" && !testnet ? "false" : "true" };
  return {};
}

/** The command a stdio venue runs: the mode flags as an env prefix, then the owner's command. */
export function composeTarget(base: string, env: Record<string, string>): string {
  const pairs = Object.entries(env);
  return pairs.length ? `env ${pairs.map(([k, v]) => `${k}=${v}`).join(" ")} ${base}` : base;
}

/** A connector label from a venue name ("Binance testnet" to "binance-testnet"). */
export function venueSlug(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20)
    .replace(/-+$/g, "");
  return CONNECTOR_LABEL.test(s) ? s : "venue";
}

const PRESET_SLUG: Record<string, string> = { "ccxt-mcp": "ccxt", "alpaca-mcp": "alpaca", "custom-mcp": "venue", "custom-http": "venue-api" };

interface CheckedSecrets {
  /** stdio: the env JSON; http: the header value */
  secret: string | null;
  authHeader: string | null;
  settings: VenueRow["settings"];
}

/** The wizard's secrets: preset fields only (custom presets take any env or header name), one line each. */
export function checkSecrets(preset: TradingVenuePreset, secrets: Record<string, string> | undefined): CheckedSecrets {
  const out: CheckedSecrets = { secret: null, authHeader: null, settings: {} };
  const entries = Object.entries(secrets ?? {})
    .map(([k, v]) => [k.trim(), String(v ?? "").trim()] as const)
    .filter(([, v]) => v.length > 0);
  if (entries.length === 0) return out;
  const allowed = new Set(preset.secrets.map((s) => s.key));
  for (const [k, v] of entries) {
    if (preset.kind !== "custom" && !allowed.has(k)) throw invalid(`secrets: ${clip(k, 40)} is not a field of the ${preset.label} preset`, "invalid_secret");
    if (v.length > VENUE_LIMITS.secretChars) throw invalid(`secrets: ${clip(k, 40)} is too long`, "invalid_secret");
    if (/[\r\n\0]/.test(v)) throw invalid(`secrets: ${clip(k, 40)} must be one line`, "invalid_secret");
    if (/(^|_)EXCHANGE(_?ID)?$/.test(k) && /^[a-z0-9_.-]{1,40}$/i.test(v)) out.settings.exchange = v.toLowerCase();
  }
  if (preset.connector === "mcp_stdio") {
    for (const [k] of entries) if (!ENV_NAME.test(k)) throw invalid(`secrets: ${clip(k, 40)} is not an env var name (A-Z, 0-9 and _)`, "invalid_secret");
    out.secret = JSON.stringify(Object.fromEntries(entries));
    return out;
  }
  const [k, v] = entries[0]!;
  if (!HEADER_NAME.test(k)) throw invalid(`secrets: ${clip(k, 40)} is not a header name`, "invalid_secret");
  if (entries.length > 1) throw invalid("secrets: an HTTP API venue takes one auth header", "invalid_secret");
  out.secret = v;
  out.authHeader = k;
  return out;
}

export interface DeskDeps {
  ctx: ModuleContext;
  repo: TradingRepo;
  venue: TradingVenue | null;
  settings(): Promise<TradingSettings>;
  log: Logger;
  /** boot-time platform features; absent keeps every feature on */
  platform?: PlatformInfo;
}

export type Desk = ReturnType<typeof createDesk>;

export function createDesk(d: DeskDeps) {
  const { ctx, repo, log } = d;
  let memory: VenueMemory | null = null;
  const sims = new Map<string, { sim: VenueSimulator; row: VenueRow }>();
  const pending = new Map<string, Promise<VenueRow>>();
  const notesCache = new Map<AgentRole, { at: number; notes: VenueNote[] }>();
  const noteText = new Map<string, string>();
  const lessonKeys = new Set<string>();
  /** background work besides the learning passes (settings sync) */
  const background = new Set<Promise<unknown>>();
  let closed = false;

  function track(p: Promise<unknown>): void {
    const q = p.catch((e: unknown) => log.log("warn", "venue background work failed", { error: errText(e) })).finally(() => background.delete(q));
    background.add(q);
  }

  const invalidate = () => {
    notesCache.clear();
    noteText.clear();
  };

  // ------------------------------------------------------------ rows
  const simOf = (id: string) => sims.get(id) ?? null;
  const isSim = (r: VenueRow) => r.preset === SIM_PRESET;

  async function rows(): Promise<VenueRow[]> {
    return [...(await repo.venues()), ...[...sims.values()].map((s) => s.row)];
  }
  async function getRow(id: string): Promise<VenueRow | null> {
    return simOf(id)?.row ?? (await repo.venue(id));
  }
  async function requireRow(id: string): Promise<VenueRow> {
    const r = await getRow(id);
    if (!r) throw notFound("venue");
    return r;
  }
  async function saveRow(r: VenueRow): Promise<void> {
    const s = simOf(r.id);
    if (s) s.row = r;
    else await repo.saveVenue(r);
    invalidate();
  }

  function admin(): Required<Pick<TradingVenue, "list" | "create" | "update" | "remove">> & Pick<TradingVenue, "test"> {
    const v = d.venue;
    if (!v || !v.list || !v.create || !v.update || !v.remove) throw new HttpError(503, "unavailable", "connectors are not available in this build");
    return { list: v.list.bind(v), create: v.create.bind(v), update: v.update.bind(v), remove: v.remove.bind(v), test: v.test?.bind(v) };
  }
  async function connectors(): Promise<Map<string, ConnectorDTO>> {
    try {
      return new Map(((await d.venue?.list?.()) ?? []).map((c) => [c.id, c]));
    } catch (e) {
      log.log("warn", "connector list failed", { error: errText(e) });
      return new Map();
    }
  }

  // ----------------------------------------------------------- tools
  function simTools(): VenueTool[] {
    const out: VenueTool[] = [];
    for (const { sim, row } of sims.values()) {
      if (!row.enabled) continue;
      for (const t of sim.tools) out.push({ name: `${sim.label}.${t.local}`, connectorId: row.connectorId, alias: `${sim.label}__${t.local}`, description: t.description, risk: t.risk, money: t.money, schema: t.schema });
    }
    return out;
  }

  /** every connector tool plus the simulators' */
  async function tools(): Promise<VenueTool[]> {
    let conn: VenueTool[] = [];
    if (d.venue) {
      try {
        conn = await d.venue.tools({});
      } catch (e) {
        log.log("warn", "venue tool list failed", { error: errText(e) });
      }
    }
    return [...conn, ...simTools()];
  }

  async function call(name: string, args: Record<string, unknown>, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<{ ok: boolean; output: string }> {
    const dotted = name.includes(".") ? name : name.replace("__", ".");
    const label = dotted.slice(0, dotted.indexOf("."));
    for (const { sim, row } of sims.values()) {
      if (sim.label !== label) continue;
      if (!row.enabled) return { ok: false, output: `${row.label} is disabled` };
      try {
        const r = await sim.call(dotted.slice(label.length + 1), args);
        return { ok: r.ok, output: redact(r.output) };
      } catch (e) {
        return { ok: false, output: `${dotted} failed: ${errText(e)}` };
      }
    }
    if (!d.venue) return { ok: false, output: `unknown venue tool ${name}` };
    return d.venue.call(name, args, opts);
  }

  // ------------------------------------------------------------- dto
  function statusOf(r: VenueRow, conn: ConnectorDTO | undefined): { status: TradingVenueDTO["status"]; error: string | null } {
    if (!r.enabled) return { status: "disabled", error: null };
    if (pending.has(r.id)) return { status: "learning", error: null };
    if (!isSim(r)) {
      if (!conn) return { status: "error", error: "the connector of this venue was removed; add the venue again" };
      if (conn.status !== "connected") return { status: "error", error: conn.error ?? "the connector is not connected" };
    }
    // a pass that a restart cut short reads as connected
    if (r.status === "learning") return { status: "connected", error: null };
    return { status: r.status, error: r.status === "error" ? r.error : null };
  }

  async function learnedSkills(r: VenueRow): Promise<TradingVenueDTO["learnedSkills"]> {
    if (!memory) return [];
    try {
      const names = new Set(SKILL_TOPICS.map((t) => skillName(r.skillKey, t)));
      return (await memory.sharedSkills(skillPrefix(r.skillKey))).filter((s) => names.has(s.name)).map((s) => ({ id: s.id, name: s.name, uses: s.uses, wins: s.wins }));
    } catch (e) {
      log.log("warn", "venue skills read failed", { error: errText(e) });
      return [];
    }
  }

  async function dto(r: VenueRow, conns?: Map<string, ConnectorDTO>): Promise<TradingVenueDTO> {
    const st = statusOf(r, (conns ?? (await connectors())).get(r.connectorId));
    return {
      id: r.id,
      connectorId: r.connectorId,
      preset: r.preset,
      label: r.label,
      mode: r.mode,
      testnet: r.testnet,
      status: st.status,
      error: st.error,
      learnedSkills: await learnedSkills(r),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  // --------------------------------------------------------- learning
  function learnLater(id: string): void {
    void learn(id).catch((e) => log.log("warn", "venue learning failed", { venue: id, error: errText(e) }));
  }

  function learn(id: string): Promise<VenueRow> {
    const running = pending.get(id);
    if (running) return running;
    const p = learnPass(id).finally(() => {
      pending.delete(id);
      invalidate();
    });
    pending.set(id, p);
    return p;
  }

  async function learnPass(id: string): Promise<VenueRow> {
    const row = await requireRow(id);
    if (!row.enabled) throw conflict("the venue is disabled; enable it first");
    if (!isSim(row)) {
      let conn = (await connectors()).get(row.connectorId);
      if (!conn) throw conflict("the connector of this venue was removed; add the venue again");
      if (conn.status !== "connected" && d.venue?.test) conn = await d.venue.test(row.connectorId);
      if (conn.status !== "connected") {
        const next: VenueRow = { ...row, status: "error", error: conn.error ?? "the connector is not connected", updatedAt: ctx.clock.now() };
        await saveRow(next);
        return next;
      }
    }
    await saveRow({ ...row, status: "learning", error: null, updatedAt: ctx.clock.now() });
    const mine = (await tools()).filter((t) => t.connectorId === row.connectorId);
    let next: VenueRow;
    try {
      const { profile, skills } = await learnVenue({
        title: row.label,
        mode: row.mode,
        testnet: row.testnet,
        tools: mine,
        exchange: row.settings.exchange ?? null,
        call: (name, args) => call(name, args, { timeoutMs: VENUE_LIMITS.callTimeoutMs }),
        now: () => performance.now(),
      });
      if (memory) {
        for (const s of skills) await memory.saveSkill({ name: skillName(row.skillKey, s.topic), description: s.description, role: null, steps: s.steps });
      }
      const ready = profile.price !== null;
      next = {
        ...row,
        profile,
        status: ready ? "ready" : "error",
        error: ready ? null : mine.length ? "no read-only price tool answered; the crew can still reach the venue's tools with find_tools" : "the venue has no tools",
        skillVersion: row.skillVersion + 1,
        learnedAt: ctx.clock.now(),
        updatedAt: ctx.clock.now(),
      };
    } catch (e) {
      next = { ...row, status: "error", error: `learning failed: ${errText(e)}`, updatedAt: ctx.clock.now() };
    }
    if (closed) return next;
    await saveRow(next);
    log.log("info", "venue learned", { venue: row.id, status: next.status, version: next.skillVersion, calls: next.profile?.calls ?? 0 });
    return next;
  }

  // ------------------------------------------------------------ notes
  async function noteOf(r: VenueRow): Promise<string> {
    const key = `${r.id}:${r.skillVersion}:${r.label}:${r.mode}:${r.testnet}`;
    const hit = noteText.get(key);
    if (hit) return hit;
    let skills: Array<{ name: string; description: string }> = [];
    if (memory) {
      try {
        skills = await memory.sharedSkills(skillPrefix(r.skillKey));
      } catch (e) {
        log.log("warn", "venue skills read failed", { error: errText(e) });
      }
    }
    if (skills.length === 0 && r.profile) skills = venueSkills({ title: r.label, mode: r.mode, testnet: r.testnet }, r.profile).map((s) => ({ name: skillName(r.skillKey, s.topic), description: s.description }));
    const text = venueNote(r.label, r.mode, r.testnet, r.skillVersion, skills, r.skillKey);
    noteText.set(key, text);
    return text;
  }

  // ------------------------------------------------------- execution
  /** ready venues that can price: enabled, learned, connected; paper-mode ones first */
  async function ready(): Promise<VenueRow[]> {
    const conns = await connectors();
    return (await rows())
      .filter((r) => r.enabled && r.status === "ready" && r.profile?.price && !pending.has(r.id) && (isSim(r) || conns.get(r.connectorId)?.status === "connected"))
      .sort((a, b) => Number(a.mode === "live") - Number(b.mode === "live") || a.createdAt - b.createdAt);
  }

  function fixedFor(t: Pick<VenueTool, "schema">, fixed: Record<string, string>): Record<string, string> {
    const props = ((t.schema as { properties?: Record<string, unknown> }).properties ?? {}) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(fixed).filter(([k]) => k in props));
  }

  async function lesson(tool: string, output: string, runId: string | null): Promise<void> {
    if (!memory) return;
    const first = redact(output).replace(/^error:\s*/i, "").split("\n")[0]!.trim();
    const shape = first.replace(/[0-9a-f]{8,}|\d+(\.\d+)?/gi, "#").slice(0, 120);
    const key = `${tool}|${shape}`;
    if (lessonKeys.has(key)) return;
    lessonKeys.add(key);
    if (lessonKeys.size > VENUE_LIMITS.lessonKeys) lessonKeys.delete(lessonKeys.values().next().value!);
    try {
      await memory.record({ text: `${tool} failed with "${clip(first, 140)}": ${errorMeaning(first)}.`, tags: [tool.slice(0, tool.indexOf(".")) || "venue", "venue", "tool-error"], role: null, projectId: null, runId, scope: "global" });
    } catch (e) {
      log.log("warn", "venue lesson record failed", { error: errText(e) });
    }
  }

  const desk = {
    tools,
    call,
    idle: async () => {
      while (pending.size || background.size) await Promise.allSettled([...pending.values(), ...background]);
    },
    track,
    close() {
      closed = true;
    },
    useMemory(m: VenueMemory) {
      memory = m;
      invalidate();
    },

    async list(): Promise<TradingVenueDTO[]> {
      const conns = await connectors();
      return Promise.all((await rows()).map((r) => dto(r, conns)));
    },

    async create(body: CreateTradingVenueBody): Promise<TradingVenueDTO> {
      const preset = presetOf(body.preset);
      const mode = body.mode === "live" ? "live" : "paper";
      if (preset.connector === "mcp_stdio") assertFeature(d.platform, "mcpStdio");
      if (mode === "live") assertFeature(d.platform, "liveTrading");
      const testnet = body.testnet === true;
      if (mode === "paper" && !preset.supportsPaper) throw invalid(`mode: ${preset.label} has no paper mode`);
      if (testnet && !preset.supportsTestnet) throw invalid(`testnet: ${preset.label} has no testnet`);
      const base = (body.target ?? preset.target).trim();
      if (!base || /^https?:\/\/$/.test(base)) throw invalid(preset.connector === "mcp_stdio" ? "target: give the command that starts the MCP server" : "target: give the API base URL");
      const secrets = checkSecrets(preset, body.secrets);
      const a = admin();
      const target = preset.connector === "mcp_stdio" ? composeTarget(base, modeEnv(preset.id, mode, testnet, await d.settings())) : base;
      const all = await a.list();
      const reuse = all.find((c) => c.kind === preset.connector && (c.target === target || c.target === redact(target)));
      let conn: ConnectorDTO;
      let owns = true;
      if (reuse) {
        if (await repo.venueByConnector(reuse.id)) throw conflict(`the ${reuse.label} connector already has a venue`);
        owns = false;
        const patch: UpdateConnectorBody = {};
        if (secrets.secret) {
          patch.secret = secrets.secret;
          if (secrets.authHeader) patch.authHeader = secrets.authHeader;
        }
        conn = Object.keys(patch).length ? await a.update(reuse.id, patch) : reuse;
      } else {
        const taken = new Set(all.map((c) => c.label));
        const root = body.label?.trim() ? venueSlug(body.label) : (PRESET_SLUG[preset.id] ?? venueSlug(preset.id));
        let label = root;
        for (let i = 2; taken.has(label); i++) label = `${root.slice(0, 20)}-${i}`;
        const create: CreateConnectorBody = { kind: preset.connector, label, target, roles: null };
        if (secrets.secret) create.secret = secrets.secret;
        if (secrets.authHeader) create.authHeader = secrets.authHeader;
        conn = await a.create(create);
      }
      const now = ctx.clock.now();
      const row: VenueRow = {
        id: ctx.clock.id(),
        connectorId: conn.id,
        ownsConnector: owns,
        preset: preset.id,
        label: clip(body.label?.trim() || preset.label, VENUE_LIMITS.labelChars),
        skillKey: conn.label,
        target: base,
        mode,
        testnet,
        enabled: true,
        status: conn.status === "connected" ? "connected" : "error",
        error: conn.status === "connected" ? null : (conn.error ?? "not connected"),
        profile: null,
        settings: secrets.settings,
        skillVersion: 0,
        learnedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      try {
        await repo.insertVenue(row);
      } catch (e) {
        if (owns) await a.remove(conn.id).catch(() => undefined);
        if (await repo.venueByConnector(conn.id)) throw conflict(`the ${conn.label} connector already has a venue`);
        throw e;
      }
      invalidate();
      if (row.status === "connected") learnLater(row.id);
      return dto(row);
    },

    async update(id: string, body: UpdateTradingVenueBody): Promise<TradingVenueDTO> {
      const row = await requireRow(id);
      if (body.preset !== undefined && body.preset !== row.preset) throw invalid("preset: a venue keeps its preset; add a new venue instead");
      if (body.mode === "live") assertFeature(d.platform, "liveTrading");
      if (body.enabled === true && !row.enabled && !isSim(row) && presetOf(row.preset).connector === "mcp_stdio") assertFeature(d.platform, "mcpStdio");
      const next: VenueRow = { ...row, updatedAt: ctx.clock.now() };
      if (body.label !== undefined) {
        const label = clip(body.label.trim(), VENUE_LIMITS.labelChars);
        if (!label) throw invalid("label: give the venue a name");
        next.label = label;
      }
      if (isSim(row)) {
        if (body.target !== undefined || body.secrets !== undefined || body.testnet !== undefined) throw invalid("a simulated venue has no command, secrets or testnet");
        if (body.mode !== undefined) next.mode = body.mode === "live" ? "live" : "paper";
        if (body.enabled !== undefined) next.enabled = body.enabled;
        const relearn = next.mode !== row.mode || (next.enabled && !row.enabled);
        await saveRow(next);
        if (relearn && next.enabled) learnLater(id);
        return dto(next);
      }
      const preset = presetOf(row.preset);
      if (body.mode !== undefined) {
        next.mode = body.mode === "live" ? "live" : "paper";
        if (next.mode === "paper" && !preset.supportsPaper) throw invalid(`mode: ${preset.label} has no paper mode`);
      }
      if (body.testnet !== undefined) {
        if (body.testnet && !preset.supportsTestnet) throw invalid(`testnet: ${preset.label} has no testnet`);
        next.testnet = body.testnet;
      }
      if (body.target !== undefined) {
        const t = body.target.trim();
        if (!t || /^https?:\/\/$/.test(t)) throw invalid("target: give the command or URL");
        next.target = t;
      }
      const patch: UpdateConnectorBody = {};
      const settings = await d.settings();
      const composed = (r: VenueRow) => (preset.connector === "mcp_stdio" ? composeTarget(r.target, modeEnv(preset.id, r.mode, r.testnet, settings)) : r.target);
      if (composed(next) !== composed(row)) patch.target = composed(next);
      if (body.secrets !== undefined) {
        const s = checkSecrets(preset, body.secrets);
        patch.secret = s.secret ?? "";
        if (preset.connector !== "mcp_stdio") patch.authHeader = s.authHeader ?? "";
        next.settings = { ...next.settings, ...s.settings };
      }
      if (body.enabled !== undefined && body.enabled !== row.enabled) {
        next.enabled = body.enabled;
        patch.enabled = body.enabled;
      }
      let conn: ConnectorDTO | null = null;
      if (Object.keys(patch).length) {
        try {
          conn = await admin().update(row.connectorId, patch);
        } catch (e) {
          if (e instanceof HttpError && e.status === 404) {
            next.status = "error";
            next.error = "the connector of this venue was removed; add the venue again";
            await saveRow(next);
            return dto(next);
          }
          throw e;
        }
      }
      const relearn = patch.target !== undefined || patch.secret !== undefined || next.mode !== row.mode || next.testnet !== row.testnet || (next.enabled && !row.enabled);
      if (!next.enabled) {
        next.status = "disabled";
        next.error = null;
      } else if (conn) {
        next.status = conn.status === "connected" ? (relearn ? "connected" : row.status === "disabled" ? "connected" : row.status) : "error";
        next.error = conn.status === "connected" ? null : (conn.error ?? "not connected");
      }
      await saveRow(next);
      if (next.enabled && next.status !== "error" && relearn) learnLater(id);
      return dto(next);
    },

    async remove(id: string): Promise<void> {
      const row = await requireRow(id);
      if (isSim(row)) sims.delete(id);
      else {
        await repo.removeVenue(id);
        if (row.ownsConnector) {
          try {
            await admin().remove(row.connectorId);
          } catch (e) {
            if (!(e instanceof HttpError && e.status === 404)) log.log("warn", "venue connector remove failed", { error: errText(e) });
          }
        }
      }
      invalidate();
      if (memory) await memory.deleteSharedSkills(skillPrefix(row.skillKey)).catch((e: unknown) => log.log("warn", "venue skills delete failed", { error: errText(e) }));
    },

    /** runs the pass; answers when it ends, or after waitMs with the venue still learning */
    async learn(id: string, waitMs: number = VENUE_LIMITS.learnWaitMs): Promise<TradingVenueDTO> {
      await requireRow(id);
      // settles either way, so a pass that fails after the wait is never an unhandled rejection
      const outcome = learn(id).then(
        (row) => ({ row, error: null }),
        (error: unknown) => ({ row: null, error }),
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      const r = await Promise.race([outcome, new Promise<null>((res) => (timer = setTimeout(() => res(null), waitMs)))]).finally(() => clearTimeout(timer));
      if (!r) return dto(await requireRow(id));
      if (r.error) throw r.error;
      return dto(r.row!);
    },

    async notes(role: AgentRole): Promise<VenueNote[]> {
      const hit = notesCache.get(role);
      if (hit && Date.now() - hit.at < VENUE_LIMITS.notesTtlMs) return hit.notes;
      const conns = await connectors();
      const out: VenueNote[] = [];
      for (const r of await rows()) {
        if (!r.enabled || r.status !== "ready" || !r.profile || pending.has(r.id)) continue;
        if (!isSim(r)) {
          const c = conns.get(r.connectorId);
          if (!c || c.status !== "connected" || (c.roles && !c.roles.includes(role))) continue;
        }
        out.push({ venueId: r.id, version: r.skillVersion, text: await noteOf(r) });
      }
      notesCache.set(role, { at: Date.now(), notes: out });
      return out;
    },

    async connectSimulator(sim: VenueSimulator, opts: { mode?: "paper" | "live" } = {}): Promise<TradingVenueDTO> {
      const label = String(sim.label ?? "").toLowerCase();
      if (!CONNECTOR_LABEL.test(label)) throw invalid("simulator label: lowercase letters, digits and -");
      const id = `sim-${label}`;
      const prior = simOf(id)?.row;
      const now = ctx.clock.now();
      const row: VenueRow = {
        id,
        connectorId: `sim:${label}`,
        ownsConnector: false,
        preset: SIM_PRESET,
        label: clip(sim.title || label, VENUE_LIMITS.labelChars),
        skillKey: label,
        target: "",
        // no live mode without the crew sandbox, even for a simulated venue
        mode: opts.mode === "live" && d.platform?.features.liveTrading !== false ? "live" : "paper",
        testnet: false,
        enabled: true,
        status: "connected",
        error: null,
        profile: null,
        settings: {},
        skillVersion: prior?.skillVersion ?? 0,
        learnedAt: null,
        createdAt: prior?.createdAt ?? now,
        updatedAt: now,
      };
      sims.set(id, { sim: { ...sim, label }, row });
      invalidate();
      return dto(await learn(id));
    },

    /** the venue a new order goes to: live needs a live-mode venue with a learned order tool; paper takes any ready venue */
    async route(mode: "paper" | "live"): Promise<{ row: VenueRow; orderTool: VenueTool | null } | null> {
      const list = await ready();
      if (mode === "paper") {
        const r = list.find((x) => x.mode === "paper") ?? list[0];
        return r ? { row: r, orderTool: null } : null;
      }
      const all = await tools();
      for (const r of list) {
        if (r.mode !== "live" || !r.profile?.order) continue;
        const t = all.find((x) => x.name === r.profile!.order!.tool && x.money);
        if (t) return { row: r, orderTool: t };
      }
      return null;
    },

    async hasLiveVenue(): Promise<boolean> {
      return (await desk.route("live")) !== null;
    },

    /** the last price from the ready venues' learned price tools, in the venue's symbol form */
    async price(symbol: string, opts: { signal?: AbortSignal; runId?: string | null; venueId?: string | null } = {}): Promise<{ price: number; source: string; venueId: string } | null> {
      const list = await ready();
      const ordered = opts.venueId ? [...list.filter((r) => r.id === opts.venueId), ...list.filter((r) => r.id !== opts.venueId)] : list;
      const all = await tools();
      for (const r of ordered) {
        const p = r.profile!.price!;
        const t = all.find((x) => x.name === p.tool);
        if (!t) continue;
        const vs = toVenueSymbol(symbol, r.profile!.symbols?.sep);
        const res = await call(p.tool, { ...fixedFor(t, r.profile!.fixedArgs), [p.arg]: p.list ? [vs] : vs }, { signal: opts.signal, timeoutMs: VENUE_LIMITS.callTimeoutMs });
        if (!res.ok) {
          if (opts.runId) await lesson(p.tool, res.output, opts.runId);
          continue;
        }
        const price = parsePrice(res.output);
        if (price !== null) return { price, source: p.tool, venueId: r.id };
      }
      return null;
    },

    /** the venue on a connector, when one is set up */
    async venueOf(connectorId: string): Promise<string | null> {
      return (await rows()).find((r) => r.connectorId === connectorId)?.id ?? null;
    },

    async row(id: string | null): Promise<VenueRow | null> {
      return id ? getRow(id) : null;
    },

    /** order tool arguments in the venue's form: its symbol, its fixed arguments, a notional when the size is in quote units */
    orderArgs(row: VenueRow | null, tool: VenueTool, o: OrderLike & { quote: number | null }): Record<string, unknown> {
      const p = row?.profile ?? null;
      const args = venueArgs(tool, { ...o, symbol: toVenueSymbol(o.symbol, p?.symbols?.sep) });
      if (!p) return args;
      Object.assign(args, fixedFor(tool, p.fixedArgs));
      const q = p.order?.tool === tool.name ? p.order : null;
      const px = o.limitPrice ?? o.quote;
      if (q?.qtyUnit === "quote" && q.params.qty && px) args[q.params.qty] = Math.round(o.qty * px * 100) / 100;
      return args;
    },

    observe(venueId: string | null, e: Parameters<NonNullable<VenueSimulator["observe"]>>[0]): void {
      if (!venueId) return;
      try {
        simOf(venueId)?.sim.observe?.(e);
      } catch (err) {
        log.log("warn", "simulator observe failed", { error: errText(err) });
      }
    },

    /** a fill (win when it realized no loss) or a failed live order (loss) on the venue's skills */
    async outcome(venueId: string | null, win: boolean, topics: ReadonlyArray<"prices" | "orders"> = ["prices", "orders"]): Promise<void> {
      if (!venueId || !memory) return;
      const r = await getRow(venueId);
      if (!r) return;
      for (const t of topics) {
        try {
          await memory.skillOutcome(skillName(r.skillKey, t), win);
        } catch (e) {
          log.log("warn", "venue skill outcome failed", { error: errText(e) });
        }
      }
    },

    lesson,

    /** live ccxt venues carry the owner's max order size as the server's own cap: keep it in step with the settings */
    async syncSettings(s: TradingSettings): Promise<void> {
      if (!d.venue?.update) return;
      const conns = await connectors();
      for (const r of await repo.venues()) {
        if (r.preset !== "ccxt-mcp" || r.mode !== "live" || r.testnet || !r.enabled) continue;
        const want = composeTarget(r.target, modeEnv(r.preset, r.mode, r.testnet, s));
        const c = conns.get(r.connectorId);
        if (!c || c.target === want) continue;
        try {
          await d.venue.update(r.connectorId, { target: want });
        } catch (e) {
          log.log("warn", "venue cap sync failed", { venue: r.id, error: errText(e) });
        }
      }
      invalidate();
    },
  };
  return desk;
}

// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Crew skills service: the built-in pack (read only, can be switched off)
// and the owner's own skills (create, edit, delete), plus the pick for one
// prompt. The owner skills and the built-in switches are read once and kept
// in memory (every write here refreshes them; a short TTL covers a second
// server process), so the per-step pick costs no query.
import type { CreateCrewSkillBody, CrewSkillDTO, UpdateCrewSkillBody } from "@mengai/shared";
import type { ModuleContext } from "../../core/module";
import { HttpError, conflict, notFound } from "../../lib/http";
import { crewSkillTokens } from "../context";
import { BUILTINS, BUILTIN_ID_PREFIX, type BuiltinSkill } from "./builtin";
import { pickSkills, type OwnerSkillView, type PickInput, type PickResult } from "./pick";
import type { CrewSkillsService } from "./ports";
import { createCrewSkillsRepo, nameKey, type OwnerSkillRow } from "./repo";

/** The owner may keep this many skills of his own. */
export const MAX_OWNER_SKILLS = 100;
/** Snapshot lifetime: another server process's writes show up within this. */
export const CACHE_TTL_MS = 30_000;
const SUMMARY_MAX = 200;

interface Snapshot {
  owner: OwnerSkillRow[];
  state: Map<string, { enabled: boolean; updatedAt: number }>;
  at: number;
}

const invalid = (message: string) => new HttpError(422, "invalid_body", message);

/** The first meaningful line of a body, without markdown markers, for a missing summary. */
export function summaryFrom(body: string): string {
  for (const raw of body.split("\n")) {
    const line = raw.replace(/^\s*(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/, "").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
    if (line) return line.length > 160 ? `${line.slice(0, 157).trimEnd()}...` : line;
  }
  return "";
}

const uniq = <T>(xs: readonly T[] | null | undefined): T[] | null => (xs && xs.length ? [...new Set(xs)] : null);

export interface CrewSkillsServiceImpl extends CrewSkillsService {
  /** drops the in-memory snapshot (tests and a restore) */
  refresh(): void;
}

export function createCrewSkillsService(ctx: ModuleContext, builtins: readonly BuiltinSkill[] = BUILTINS): CrewSkillsServiceImpl {
  const repo = createCrewSkillsRepo(ctx.db);
  const byId = new Map(builtins.map((b) => [b.id, b]));
  let snap: Snapshot | null = null;
  let loading: Promise<Snapshot> | null = null;
  /** bumped by every write: a read that started before it never becomes the snapshot */
  let generation = 0;

  async function snapshot(): Promise<Snapshot> {
    if (snap && ctx.clock.now() - snap.at < CACHE_TTL_MS) return snap;
    if (!loading) {
      const gen = generation;
      const run = (async () => {
        const [owner, state] = await Promise.all([repo.listOwner(MAX_OWNER_SKILLS * 2), repo.builtinState()]);
        const fresh: Snapshot = { owner, state, at: ctx.clock.now() };
        if (gen === generation) snap = fresh;
        return fresh;
      })();
      loading = run;
      void run.then(
        () => {
          if (loading === run) loading = null;
        },
        () => {
          if (loading === run) loading = null;
        },
      );
    }
    return loading;
  }
  const refresh = () => {
    generation++;
    snap = null;
    loading = null;
  };

  const builtinDto = (b: BuiltinSkill, state: Snapshot["state"]): CrewSkillDTO => {
    const st = state.get(b.id);
    return {
      id: b.id,
      source: "builtin",
      name: b.name,
      summary: b.summary,
      body: b.body,
      roles: [...b.roles],
      kinds: b.kinds ? [...b.kinds] : null,
      enabled: st ? st.enabled : true,
      version: b.version,
      tokens: b.tokens,
      createdAt: b.updatedAt,
      updatedAt: Math.max(b.updatedAt, st?.updatedAt ?? 0),
    };
  };

  const ownerDto = (o: OwnerSkillRow): CrewSkillDTO => ({
    id: o.id,
    source: "owner",
    name: o.name,
    summary: o.summary,
    body: o.body,
    roles: o.roles ? [...o.roles] : null,
    kinds: o.kinds ? [...o.kinds] : null,
    enabled: o.enabled,
    version: o.version,
    tokens: crewSkillTokens({ name: o.name, text: o.body }),
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  });

  /** 409 when a built-in or another owner skill already has this name. */
  async function assertNameFree(name: string, selfId: string | null): Promise<void> {
    const key = nameKey(name);
    if (builtins.some((b) => nameKey(b.name) === key)) throw conflict(`"${name.trim()}" is the name of a built-in skill; pick another name`);
    const holder = await repo.idByName(name);
    if (holder && holder !== selfId) throw conflict(`a skill named "${name.trim()}" already exists`);
  }

  const isUniqueViolation = (e: unknown) => /unique|duplicate/i.test(e instanceof Error ? e.message : String(e));

  const service: CrewSkillsServiceImpl = {
    refresh,

    async list() {
      const s = await snapshot();
      return [...builtins.map((b) => builtinDto(b, s.state)), ...s.owner.map(ownerDto)];
    },

    async create(body: CreateCrewSkillBody) {
      const name = body.name.trim().replace(/\s+/g, " ");
      const text = body.body.trim();
      if (!name) throw invalid("name: required");
      if (!text) throw invalid("body: required");
      await assertNameFree(name, null);
      if ((await repo.countOwner()) >= MAX_OWNER_SKILLS) throw conflict(`you already have ${MAX_OWNER_SKILLS} skills; delete one first`);
      const now = ctx.clock.now();
      const row: OwnerSkillRow = {
        id: ctx.clock.id(),
        name,
        summary: (body.summary?.trim() || summaryFrom(text)).slice(0, SUMMARY_MAX),
        body: text,
        roles: uniq(body.roles),
        kinds: uniq(body.kinds),
        enabled: body.enabled ?? true,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      try {
        await repo.insertOwner(row);
      } catch (e) {
        if (isUniqueViolation(e)) throw conflict(`a skill named "${name}" already exists`);
        throw e;
      }
      refresh();
      return ownerDto(row);
    },

    async update(id: string, body: UpdateCrewSkillBody) {
      const keys = (Object.keys(body) as Array<keyof UpdateCrewSkillBody>).filter((k) => body[k] !== undefined);
      if (keys.length === 0) throw invalid("nothing to change");
      const builtin = byId.get(id);
      if (builtin) {
        if (keys.some((k) => k !== "enabled")) throw invalid("built-in skills accept only enabled: switch them off or on, they are never edited");
        await repo.setBuiltin(id, body.enabled!, ctx.clock.now());
        refresh();
        return builtinDto(builtin, (await snapshot()).state);
      }
      if (id.startsWith(BUILTIN_ID_PREFIX)) throw notFound("crew skill");
      const cur = await repo.getOwner(id);
      if (!cur) throw notFound("crew skill");
      const next: OwnerSkillRow = { ...cur };
      if (body.name !== undefined) {
        const name = body.name.trim().replace(/\s+/g, " ");
        if (!name) throw invalid("name: required");
        if (nameKey(name) !== nameKey(cur.name)) await assertNameFree(name, id);
        next.name = name;
      }
      if (body.body !== undefined) {
        const text = body.body.trim();
        if (!text) throw invalid("body: required");
        next.body = text;
      }
      if (body.summary !== undefined) next.summary = (body.summary.trim() || summaryFrom(next.body)).slice(0, SUMMARY_MAX);
      if (body.roles !== undefined) next.roles = uniq(body.roles);
      if (body.kinds !== undefined) next.kinds = uniq(body.kinds);
      if (body.enabled !== undefined) next.enabled = body.enabled;
      const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
      const edited = next.name !== cur.name || next.body !== cur.body || next.summary !== cur.summary || !same(next.roles, cur.roles) || !same(next.kinds, cur.kinds);
      if (!edited && next.enabled === cur.enabled) return ownerDto(cur);
      if (edited) next.version = cur.version + 1;
      next.updatedAt = ctx.clock.now();
      try {
        await repo.updateOwner(next);
      } catch (e) {
        if (isUniqueViolation(e)) throw conflict(`a skill named "${next.name}" already exists`);
        throw e;
      }
      refresh();
      return ownerDto(next);
    },

    async remove(id: string) {
      if (byId.has(id)) throw conflict("built-in skills cannot be deleted; switch one off with enabled false");
      if (id.startsWith(BUILTIN_ID_PREFIX) || !(await repo.deleteOwner(id))) throw notFound("crew skill");
      refresh();
    },

    async forPrompt(input: PickInput): Promise<PickResult> {
      const s = await snapshot();
      const owner: OwnerSkillView[] = s.owner;
      return pickSkills(input, builtins, (id) => s.state.get(id)?.enabled ?? true, owner, crewSkillTokens);
    },
  };
  return service;
}

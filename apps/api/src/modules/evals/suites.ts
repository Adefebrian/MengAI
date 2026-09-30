// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Scenario fixtures (JSON) validated at load, plus the fixture tool schemas
// used when no ToolsService is injected. A scenario is one agent working one
// task: role, brief, task packet and the exact steps (tool names, arguments,
// raw output sizes) the scripted model takes.
import { AGENT_ROLES, ROLE_TOOLS, TOOL_NAMES } from "@mengai/shared";
import type { AgentRole } from "@mengai/shared";
import { z } from "zod";
import type { ToolSpec } from "../../core/ports/llm";
import coreSuite from "./fixtures/core.json";
import toolFixtures from "./fixtures/tools.json";

const ToolUse = z.object({
  name: z.string().min(1),
  args: z.record(z.unknown()),
  outputChars: z.number().int().min(0).max(2_000_000),
  ok: z.boolean().optional(),
});

const Step = z.object({ say: z.string(), tools: z.array(ToolUse).min(1) });

const Scenario = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,64}$/),
  role: z.enum(AGENT_ROLES),
  project: z.string().min(1),
  goal: z.string().min(1),
  workspaceDigest: z.string(),
  lessons: z.array(z.string()),
  task: z
    .object({
      title: z.string().min(1),
      spec: z.string(),
      acceptance: z.array(z.string()),
      depSummaries: z.array(z.string()).optional(),
      handoff: z.string().nullable().optional(),
    })
    .nullable(),
  steps: z.array(Step).min(1),
});

const Suite = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  title: z.string(),
  model: z.string().min(1),
  contextWindow: z.number().int().min(1024),
  scenarios: z.array(Scenario).min(1),
});

const ToolSpecSchema = z.object({ name: z.string(), description: z.string(), parameters: z.record(z.unknown()) });

export type ScenarioFixture = z.infer<typeof Scenario>;
export type SuiteFixture = z.infer<typeof Suite>;

const RAW_SUITES: unknown[] = [coreSuite];

let suites: Map<string, SuiteFixture> | null = null;

export function loadSuites(): Map<string, SuiteFixture> {
  if (suites) return suites;
  const out = new Map<string, SuiteFixture>();
  for (const raw of RAW_SUITES) {
    const s = Suite.parse(raw);
    out.set(s.id, s);
  }
  suites = out;
  return out;
}

let tools: Map<string, ToolSpec> | null = null;

function fixtureTools(): Map<string, ToolSpec> {
  if (tools) return tools;
  const list = z.array(ToolSpecSchema).parse(toolFixtures);
  const out = new Map<string, ToolSpec>();
  for (const t of list) out.set(t.name, t);
  for (const name of TOOL_NAMES) if (!out.has(name)) throw new Error(`fixture tool schema missing: ${name}`);
  tools = out;
  return out;
}

/** The role's tool set (ROLE_TOOLS) with the fixture schemas. */
export function fixtureSpecsFor(role: AgentRole): ToolSpec[] {
  const all = fixtureTools();
  return ROLE_TOOLS[role].map((name) => all.get(name)!);
}

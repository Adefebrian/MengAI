// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Critic round 2: one coat per cat with the CEO pinned ginger, desk plates
// and monitors fed from the same task state as the strip, meeting seats
// from the live crew, the version history in version order.
import { describe, expect, test } from "bun:test";
import type { AgentDTO, StrategyVersionDTO, TaskDTO } from "@mengai/shared";
import { DEMO_EVENTS } from "../../demo/fixture";
import { withCrewLooks } from "../../store/looks";
import { replay } from "../../store/runStore";
import { newestFirst, withArticles } from "../run/Mind";
import { deskActivity, deskTask, officeAgents, plateTitle } from "../run/office";
import { sentence } from "../parts/Orders";

const base = replay(DEMO_EVENTS);
const sample = Object.values(base.agents)[0]!;
const cat = (id: string, role: AgentDTO["role"], coat: AgentDTO["look"]["coat"], createdAt: number): AgentDTO => ({ ...sample, id, name: id, role, look: { coat, seed: createdAt * 7 + 3 }, createdAt });

describe("crew looks", () => {
  test("the lead is ginger and no coat repeats in one crew", () => {
    const crew = [cat("oyen", "lead", "gray", 1), cat("pukis", "qa", "calico", 2), cat("jahe", "engineer", "calico", 3), cat("kolak", "reviewer", "calico", 4), cat("lemper", "designer", "ginger", 5)];
    const out = withCrewLooks(crew);
    expect(out[0]!.look.coat).toBe("ginger");
    expect(new Set(out.map((a) => a.look.coat)).size).toBe(out.length);
    expect(out.map((a) => a.look.seed)).toEqual(crew.map((a) => a.look.seed));
  });

  test("a crew that already follows the rule comes back as the same objects", () => {
    const crew = [cat("oyen", "lead", "ginger", 1), cat("a", "qa", "calico", 2), cat("b", "engineer", "tuxedo", 3)];
    const out = withCrewLooks(crew);
    out.forEach((a, i) => expect(a).toBe(crew[i]!));
  });

  test("the store keeps the rule for every run it folds", () => {
    const crew = Object.values(base.agents);
    const lead = crew.find((a) => a.role === "lead")!;
    expect(lead.look.coat).toBe("ginger");
    expect(new Set(crew.map((a) => a.look.coat)).size).toBe(Math.min(crew.length, 8));
  });
});

describe("desk plates and monitors", () => {
  test("a review task reads Reviewing and keeps the diff up", () => {
    expect(plateTitle("Review: Scaffold the landing page")).toBe("Reviewing Scaffold the landing page");
    expect(plateTitle("Fix: Scaffold the landing page")).toBe("Fixing Scaffold the landing page");
    const t: TaskDTO = { ...Object.values(base.tasks)[0]!, id: "t-review", title: "Review: Scaffold the landing page", status: "running", role: "reviewer", parentId: null };
    const a = cat("kolak", "reviewer", "gray", 9);
    expect(deskActivity({ ...a, status: "thinking", activity: "think" }, t, base)).toBe("review");
    expect(deskActivity({ ...a, status: "idle", activity: "rest" }, undefined, base)).toBe("rest");
  });

  test("a cat that holds an open task shows it even with no current task id", () => {
    const [id] = base.taskOrder;
    const t = base.tasks[id!]!;
    const owner = cat("holder", "engineer", "tuxedo", 11);
    const s = { ...base, agents: { ...base.agents, [owner.id]: { ...owner, currentTaskId: null, status: "waiting" as const, activity: "rest" as const } }, agentOrder: [...base.agentOrder, owner.id], tasks: { ...base.tasks, [t.id]: { ...t, assigneeId: owner.id, status: "review" as const } } };
    expect(deskTask(s.agents[owner.id]!, s)?.id).toBe(t.id);
    const desk = officeAgents(s, {}).find((a) => a.id === owner.id)!;
    expect(desk.taskTitle).not.toBeNull();
    expect(desk.activity).toBe("wait");
  });
});

describe("copy", () => {
  test("articles, sentences and the version order", () => {
    expect(withArticles("the plan needs a engineer: Scaffold")).toBe("the plan needs an engineer: Scaffold");
    expect(withArticles("a user and a designer")).toBe("a user and a designer");
    expect(sentence("add on a pullback")).toBe("Add on a pullback");
    const v = (version: number, createdAt: number) => ({ id: `v${version}`, version, createdAt }) as StrategyVersionDTO;
    expect(newestFirst([v(2, 5), v(3, 4), v(1, 1)]).map((x) => x.version)).toEqual([3, 2, 1]);
  });
});

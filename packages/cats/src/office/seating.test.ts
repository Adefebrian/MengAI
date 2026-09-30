// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Who sits where as the crew changes: desks are handed out by role once,
// then kept; a hire takes a free desk or the next one, a leaver stays until
// it has walked out and leaves its desk free, a new crew starts over.
import { describe, expect, test } from "bun:test";
import type { AgentRole } from "@mengai/shared";
import type { OfficeAgent } from "../office-contract";
import { advanceTrack, dropLeaver, isVacant, MAX_VACANT, startTrack } from "./seating";

function cat(id: string, role: AgentRole, parentId: string | null = "oyen"): OfficeAgent {
  return {
    id,
    name: id,
    role,
    look: { coat: "ginger", seed: id.length * 31 },
    status: "working",
    activity: "code",
    mood: "calm",
    energy: 0.2,
    parentId,
    taskTitle: null,
    statusText: "busy",
    file: null,
  };
}

const CREW = [cat("oyen", "lead", null), cat("qa1", "qa"), cat("eng1", "engineer"), cat("eng2", "engineer"), cat("des1", "designer")];

describe("seating", () => {
  test("the first crew sits by role, the lead first", () => {
    const t = startTrack(CREW);
    expect(t.planAgents.map((a) => a.id)).toEqual(["oyen", "eng1", "eng2", "des1", "qa1"]);
    expect(t.arriving).toEqual([]);
  });

  test("a hire takes the next desk at the end and walks in; nobody else moves", () => {
    const t0 = startTrack(CREW);
    const t1 = advanceTrack(t0, [...CREW, cat("eng3", "engineer")]);
    expect(t1.planAgents.map((a) => a.id)).toEqual(["oyen", "eng1", "eng2", "des1", "qa1", "eng3"]);
    expect(t1.arriving).toEqual(["eng3"]);
  });

  test("a leaver stays until it has walked out, then its desk is free and the next hire takes it", () => {
    const t0 = startTrack(CREW);
    const without = CREW.filter((a) => a.id !== "eng2");
    const t1 = advanceTrack(t0, without);
    expect(t1.leavers.has("eng2")).toBe(true);
    expect(t1.present.map((a) => a.id)).toContain("eng2");
    expect(t1.planAgents.map((a) => a.id)).toEqual(["oyen", "eng1", "eng2", "des1", "qa1"]);
    const t2 = dropLeaver(t1, "eng2");
    expect(t2.present.map((a) => a.id)).not.toContain("eng2");
    const ids = t2.planAgents.map((a) => a.id);
    expect(isVacant(ids[2]!)).toBe(true);
    expect(t2.planAgents[2]!.role).toBe("engineer");
    const t3 = advanceTrack(t2, [...without, cat("new1", "researcher")]);
    expect(t3.planAgents.map((a) => a.id)).toEqual(["oyen", "eng1", "new1", "des1", "qa1"]);
    expect(t3.arriving).toEqual(["new1"]);
  });

  test("at most two desks stay free", () => {
    let t = startTrack(CREW);
    for (const id of ["eng1", "eng2", "des1"]) {
      t = advanceTrack(t, t.agents.filter((a) => a.id !== id));
      t = dropLeaver(t, id);
    }
    expect(t.planAgents.filter((a) => isVacant(a.id)).length).toBe(MAX_VACANT);
  });

  test("a new crew (most of it changed) starts over without walking anyone in or out", () => {
    const t0 = startTrack(CREW);
    const other = [cat("lead2", "lead", null), cat("x1", "qa", "lead2"), cat("x2", "engineer", "lead2")];
    const t1 = advanceTrack(t0, other);
    expect(t1.arriving).toEqual([]);
    expect(t1.leavers.size).toBe(0);
    expect(t1.planAgents.map((a) => a.id)).toEqual(["lead2", "x2", "x1"]);
  });

  test("a leaver who comes back keeps its desk", () => {
    const t0 = startTrack(CREW);
    const t1 = advanceTrack(t0, CREW.filter((a) => a.id !== "des1"));
    const t2 = advanceTrack(t1, CREW);
    expect(t2.leavers.size).toBe(0);
    expect(t2.arriving).toEqual([]);
    expect(t2.planAgents.map((a) => a.id)).toEqual(["oyen", "eng1", "eng2", "des1", "qa1"]);
  });
});

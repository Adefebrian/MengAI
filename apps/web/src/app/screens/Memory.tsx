// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Memory (/app/memory): what the crew learned. Lessons in one divided
// group per status with their record (JEV core.list.grouped.actions), then
// the saved skills (card). A lesson only stays active while it keeps
// winning; you can promote, retire or delete any of them.
import { ROLE_LABEL, type LessonDTO, type LessonStatus } from "@mengai/shared";
import { EmptyState, ProductIcon, SkeletonRows, StatusPill } from "@mengai/ui/src/product";
import { useState } from "react";
import { useApp } from "../context";
import { fmtInt, fmtPct } from "../format";
import { useAction, useResource } from "../hooks";
import { LESSON_STATUS } from "../status";
import { FormStatus, Page, PageHead, Region } from "../ui";

const GROUPS: Array<{ status: LessonStatus; label: string }> = [
  { status: "candidate", label: "Candidates" },
  { status: "active", label: "Active" },
  { status: "retired", label: "Retired" },
];

function scopeText(l: LessonDTO): string {
  if (l.scope === "global") return "Every cat";
  if (l.scope === "role") return l.role ? `${ROLE_LABEL[l.role]} cats` : "One role";
  return "This project";
}

function LessonRow({ lesson, onChange, onDelete }: { lesson: LessonDTO; onChange: (l: LessonDTO) => void; onDelete: (id: string) => void }) {
  const { api } = useApp();
  const act = useAction();
  const [sure, setSure] = useState(false);
  const set = (status: LessonStatus) => act.run(async () => onChange(await api.call("PATCH /api/memory/lessons/:id", { params: { id: lesson.id }, body: { status } })));
  const played = lesson.wins + lesson.losses;
  return (
    <li className="lesson-row">
      <span className="lesson-body">
        <span className="lesson-text">{lesson.text}</span>
        <span className="lesson-meta">
          <span>{scopeText(lesson)}</span>
          <span>
            Used <span className="num">{fmtInt(lesson.uses)}</span> {lesson.uses === 1 ? "time" : "times"}
          </span>
          <span>{played ? <>Won <span className="num">{fmtPct(lesson.wins / played)}</span></> : "No record yet"}</span>
          {lesson.tags.length ? <span>{lesson.tags.join(", ")}</span> : null}
        </span>
        <FormStatus error={act.error} />
      </span>
      <span className="lesson-actions">
        {lesson.status !== "active" ? (
          <button type="button" className="btn-secondary" aria-busy={act.busy || undefined} onClick={() => set("active")}>
            <ProductIcon name="checkCircle" size={20} />
            <span>{lesson.status === "candidate" ? "Keep it" : "Bring back"}</span>
          </button>
        ) : null}
        {lesson.status !== "retired" ? (
          <button type="button" className="btn-ghost" disabled={act.busy} onClick={() => set("retired")}>
            Retire
          </button>
        ) : null}
        {sure ? (
          <button
            type="button"
            className="app-btn-destructive"
            aria-busy={act.busy || undefined}
            onClick={() =>
              act.run(async () => {
                await api.call("DELETE /api/memory/lessons/:id", { params: { id: lesson.id } });
                onDelete(lesson.id);
              })
            }
          >
            Delete for good
          </button>
        ) : (
          <button type="button" className="btn-ghost" onClick={() => setSure(true)} aria-label="Delete this lesson">
            <ProductIcon name="trash" size={20} />
            <span>Delete</span>
          </button>
        )}
      </span>
    </li>
  );
}

export function MemoryScreen() {
  const { api } = useApp();
  const lessons = useResource((signal) => api.call("GET /api/memory/lessons", { signal }), "lessons");
  const skills = useResource((signal) => api.call("GET /api/memory/skills", { signal }), "skills");
  const del = useAction();
  const all = lessons.data ?? [];
  const counts = GROUPS.map((g) => `${all.filter((l) => l.status === g.status).length} ${g.label.toLowerCase()}`).join(", ");

  return (
    <Page>
      <PageHead title="Memory" lead="What the crew learned from reviews and failures. A lesson stays in the prompt only while it keeps working." />

      <Region container="divided" title="Lessons" meta={all.length ? counts : undefined}>
        {lessons.error ? (
          <EmptyState icon="alertCircle" tone="danger" title="Lessons did not load" action={<button type="button" onClick={lessons.reload}>Try again</button>}>
            {lessons.error}
          </EmptyState>
        ) : lessons.loading && !lessons.data ? (
          <SkeletonRows rows={3} label="Loading lessons" />
        ) : all.length === 0 ? (
          <p className="app-empty-line">Nothing learned yet. Lessons show up after the first review.</p>
        ) : (
          <div className="lesson-groups">
            {GROUPS.map((g) => {
              const items = all.filter((l) => l.status === g.status);
              if (items.length === 0) return null;
              const look = LESSON_STATUS[g.status];
              return (
                <div className="lesson-group" key={g.status}>
                  <p className="task-group-label">
                    <StatusPill tone={look.tone} icon={look.icon}>
                      {g.label}
                    </StatusPill>
                    <span className="num">{items.length}</span>
                  </p>
                  <ul className="lesson-list">
                    {items.map((l) => (
                      <LessonRow
                        key={l.id}
                        lesson={l}
                        onChange={(next) => lessons.setData((prev) => (prev ?? []).map((x) => (x.id === next.id ? next : x)))}
                        onDelete={(id) => lessons.setData((prev) => (prev ?? []).filter((x) => x.id !== id))}
                      />
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </Region>

      <Region container="card" title="Skills" className="app-card" meta="Tool sequences a cat saved because they worked. Cats replay them instead of working it out again.">
        {skills.loading && !skills.data ? (
          <SkeletonRows rows={2} label="Loading skills" />
        ) : (skills.data ?? []).length === 0 ? (
          <p className="app-empty-line">No skills saved yet.</p>
        ) : (
          <ul className="skill-list">
            {(skills.data ?? []).map((s) => (
              <li className="skill-row" key={s.id}>
                <span className="skill-body">
                  <span className="skill-name">{s.name}</span>
                  <span className="skill-desc">{s.description}</span>
                  <span className="lesson-meta">
                    <span>{s.role ? `${ROLE_LABEL[s.role]} cats` : "Every cat"}</span>
                    <span>
                      <span className="num">{s.steps.length}</span> {s.steps.length === 1 ? "step" : "steps"}: <span className="num">{s.steps.map((x) => x.tool).join(", ")}</span>
                    </span>
                    <span>
                      Won <span className="num">{s.wins}</span> of <span className="num">{s.uses}</span>
                    </span>
                  </span>
                </span>
                <button
                  type="button"
                  className="btn-ghost"
                  aria-label={`Delete skill ${s.name}`}
                  disabled={del.busy}
                  onClick={() =>
                    del.run(async () => {
                      await api.call("DELETE /api/memory/skills/:id", { params: { id: s.id } });
                      skills.setData((prev) => (prev ?? []).filter((x) => x.id !== s.id));
                    })
                  }
                >
                  <ProductIcon name="trash" size={20} />
                  <span>Delete</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <FormStatus error={del.error} />
      </Region>
    </Page>
  );
}

// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Skills (/app/skills): the written instructions every matching cat reads
// next to its role charter, and the tool recipes the crew learned by
// itself. Regions per JEV ui.region_gate: the head in plain spacing, the
// built-in JAL-AIDev pack as a divided section (0.60), the owner's skills
// as rows (0.62), and the learned recipes as a divided section (card at
// 0.38 and rows at 0.37 both matched a neighbour at low confidence, so the
// next container). The write form opens in a side sheet from the rows'
// head and from each row's Edit (JEV ui.region_gate your_skills_layout
// form_in_sheet, 0.54): a form beside a short list left a tall void under
// it. Each skill's text opens in place with the an.R22 disclosure the mind
// panel uses; roles and company kinds are checkboxes with an "every"
// choice, as on Connectors. Motion tier 0: the chevron turns, the switch
// thumb slides, the sheet rises, nothing else moves. A built-in skill
// ships with MengAI and can only be switched off; an owner skill can be
// edited and deleted. A server without written skills yet shows that in
// place and the learned recipes still load.
import type { AgentRole, CompanyKind, CrewSkillDTO } from "@mengai/shared";
import { Chip, Drawer, EmptyState, ProductIcon, Sheet, SkeletonRows } from "@mengai/ui/src/product";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import { useApp } from "../context";
import {
  SKILL_BODY_MAX,
  SKILL_KINDS,
  SKILL_NAME_MAX,
  SKILL_ROLES,
  SKILL_SUMMARY_MAX,
  bodyOverBy,
  hasErrors,
  kindsWord,
  overLimitText,
  promptTokens,
  roleWord,
  rolesWord,
  validateSkill,
  type SkillErrors,
} from "../crewSkills";
import { fmtAgo, fmtInt, plural } from "../format";
import { useAction, useNow, useResource } from "../hooks";
import { COMPANY_WORD } from "../run/stages";
import { Checkbox, FormStatus, Page, PageHead, Region, Switch, TextField } from "../ui";

/** One skill's text, opened in place (an.R22): the toggle sits with the row's controls, the text under the row. */
function useReader() {
  const [open, setOpen] = useState(false);
  const id = useId();
  return { open, id, toggle: () => setOpen((v) => !v) };
}
type Reader = ReturnType<typeof useReader>;

function ReadToggle({ reader }: { reader: Reader }) {
  return (
    <button type="button" className="btn-ghost cskill-toggle" aria-expanded={reader.open} aria-controls={reader.id} onClick={reader.toggle}>
      <span className="cskill-toggle-icon" aria-hidden="true">
        <ProductIcon name="chevronDown" size={16} />
      </span>
      <span>{reader.open ? "Hide the text" : "Read the text"}</span>
    </button>
  );
}

function ReadPanel({ reader, name, body }: { reader: Reader; name: string; body: string }) {
  return (
    <div id={reader.id} className="cskill-text-wrap" hidden={!reader.open}>
      {reader.open ? (
        <div className="cskill-text" tabIndex={0} role="region" aria-label={`${name}, the text the cats read`}>
          {body}
        </div>
      ) : null}
    </div>
  );
}

function Facts({ skill, children }: { skill: CrewSkillDTO; children?: ReactNode }) {
  return (
    <span className="cskill-meta">
      {children}
      <span>{rolesWord(skill.roles)}</span>
      <span>{kindsWord(skill.kinds)}</span>
      <span>
        <span className="num">{fmtInt(skill.tokens)}</span> tokens
      </span>
    </span>
  );
}

function useToggle(skill: CrewSkillDTO, onChange: (s: CrewSkillDTO) => void) {
  const { api } = useApp();
  const act = useAction();
  const set = (enabled: boolean) =>
    void act.run(async () => {
      onChange(await api.call("PATCH /api/crew-skills/:id", { params: { id: skill.id }, body: { enabled } }));
    });
  return { set, busy: act.busy, error: act.error };
}

function BuiltinRow({ skill, onChange }: { skill: CrewSkillDTO; onChange: (s: CrewSkillDTO) => void }) {
  const toggle = useToggle(skill, onChange);
  const reader = useReader();
  return (
    <li className="cskill-row" data-off={skill.enabled ? undefined : ""}>
      <div className="cskill-main">
        <h3 className="cskill-name">{skill.name}</h3>
        {skill.summary ? <p className="cskill-summary">{skill.summary}</p> : null}
        <Facts skill={skill}>
          <Chip>Ships with MengAI</Chip>
          <span>
            Version <span className="num">{skill.version}</span>
          </span>
        </Facts>
      </div>
      <div className="cskill-side">
        <ReadToggle reader={reader} />
        <Switch label="Enabled" ariaLabel={`Enabled, ${skill.name}`} checked={skill.enabled} disabled={toggle.busy} onChange={toggle.set} />
      </div>
      {toggle.error ? (
        <div className="cskill-wide">
          <FormStatus error={toggle.error} />
        </div>
      ) : null}
      <ReadPanel reader={reader} name={skill.name} body={skill.body} />
    </li>
  );
}

function OwnerRow({ skill, now, onChange, onEdit, onDelete }: { skill: CrewSkillDTO; now: number; onChange: (s: CrewSkillDTO) => void; onEdit: (s: CrewSkillDTO) => void; onDelete: (s: CrewSkillDTO) => void }) {
  const toggle = useToggle(skill, onChange);
  const reader = useReader();
  return (
    <li className="p-rows-item" data-kind="crew-skill">
      <div className="p-row cskill-own" data-type="static">
        <span className="p-row-leading">
          <span className="cskill-icon">
            <ProductIcon name="fileText" size={20} />
          </span>
        </span>
        <div className="p-row-text">
          <h3 className="p-row-title cskill-own-name">{skill.name}</h3>
          {skill.summary ? <p className="cskill-summary">{skill.summary}</p> : null}
          <Facts skill={skill}>
            <span>
              {skill.version > 1 ? `Edited ${plural(skill.version - 1, "time")}, ` : ""}changed {fmtAgo(skill.updatedAt, now)}
            </span>
          </Facts>
          <div className="cskill-actions">
            <Switch label="Enabled" ariaLabel={`Enabled, ${skill.name}`} checked={skill.enabled} disabled={toggle.busy} onChange={toggle.set} />
            <ReadToggle reader={reader} />
            <button type="button" className="btn-secondary cskill-edit" onClick={() => onEdit(skill)} aria-label={`Edit ${skill.name}`}>
              Edit
            </button>
            <button type="button" className="btn-ghost cskill-delete" onClick={() => onDelete(skill)} aria-label={`Delete ${skill.name}`}>
              <ProductIcon name="trash" size={20} />
              <span>Delete</span>
            </button>
          </div>
          {toggle.error ? <FormStatus error={toggle.error} /> : null}
          <ReadPanel reader={reader} name={skill.name} body={skill.body} />
        </div>
      </div>
    </li>
  );
}

/** A checkbox group with an "every" choice first; the single choices show only when "every" is off. */
function ScopeChecks<T extends string>({
  legend,
  everyLabel,
  everyOn,
  everyOff,
  every,
  onEvery,
  options,
  value,
  onChange,
  word,
  hint,
  error,
}: {
  legend: string;
  everyLabel: string;
  everyOn: string;
  everyOff: string;
  every: boolean;
  onEvery: (v: boolean) => void;
  options: readonly T[];
  value: T[];
  onChange: (next: T[]) => void;
  word: (v: T) => string;
  hint: string;
  error?: string;
}) {
  return (
    <fieldset className="app-checks">
      <legend className="field-label">{legend}</legend>
      <Checkbox label={everyLabel} description={every ? everyOn : everyOff} checked={every} onChange={onEvery} />
      {every ? null : (
        <div className="connector-roles">
          {options.map((o) => (
            <Checkbox key={o} label={word(o)} checked={value.includes(o)} onChange={(on) => onChange(options.filter((x) => (x === o ? on : value.includes(x))))} />
          ))}
        </div>
      )}
      <p className="field-hint" data-state={error ? "error" : undefined} aria-live="polite">
        {error ?? hint}
      </p>
    </fieldset>
  );
}

/** A name the engine already holds (409 on a name) lands under the name field. */
function isNameTaken(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409 && /name/i.test(err.message);
}

/** The write form, mounted fresh each time the sheet opens; its actions live in the sheet's footer. */
function SkillForm({
  formId,
  editing,
  all,
  onSaved,
  onBusy,
}: {
  formId: string;
  editing: CrewSkillDTO | null;
  all: CrewSkillDTO[];
  onSaved: (s: CrewSkillDTO, created: boolean) => void;
  onBusy: (busy: boolean) => void;
}) {
  const { api } = useApp();
  const [name, setName] = useState(editing?.name ?? "");
  const [summary, setSummary] = useState(editing?.summary ?? "");
  const [body, setBody] = useState(editing?.body ?? "");
  const [everyRole, setEveryRole] = useState(editing ? editing.roles === null : true);
  const [roles, setRoles] = useState<AgentRole[]>(editing?.roles ?? ["engineer"]);
  const [everyKind, setEveryKind] = useState(editing ? editing.kinds === null : true);
  const [kinds, setKinds] = useState<CompanyKind[]>(editing?.kinds ?? ["studio"]);
  const [enabled, setEnabled] = useState(editing?.enabled ?? true);
  const [errors, setErrors] = useState<SkillErrors>({});
  const save = useAction();
  const nameRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const bodyId = useId();
  const countId = `${bodyId}-count`;
  const hintId = `${bodyId}-hint`;

  // The sheet focuses its first control when it opens; the name is where writing starts.
  useEffect(() => {
    const t = requestAnimationFrame(() => nameRef.current?.focus());
    return () => cancelAnimationFrame(t);
  }, []);
  useEffect(() => onBusy(save.busy), [save.busy, onBusy]);

  const over = bodyOverBy(body);
  const bodyError = errors.body ?? (over > 0 ? overLimitText(over) : undefined);
  const clear = (field: keyof SkillErrors) => setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (save.busy) return;
    const next = validateSkill({ name, summary, body, everyRole, roles, everyKind, kinds }, all, editing?.id ?? null);
    setErrors(next);
    if (hasErrors(next)) {
      if (next.name) nameRef.current?.focus();
      else if (next.body) bodyRef.current?.focus();
      return;
    }
    const base = { name: name.trim(), body, roles: everyRole ? null : roles, kinds: everyKind ? null : kinds, enabled };
    void save.run(async () => {
      try {
        const out = editing
          ? await api.call("PATCH /api/crew-skills/:id", { params: { id: editing.id }, body: { ...base, summary: summary.trim() } })
          : await api.call("POST /api/crew-skills", { body: summary.trim() ? { ...base, summary: summary.trim() } : base });
        onSaved(out, !editing);
      } catch (err) {
        if (isNameTaken(err)) {
          setErrors({ name: `A skill called ${name.trim()} is there already. Pick another name.` });
          nameRef.current?.focus();
          return;
        }
        throw err;
      }
    });
  };

  const tokens = promptTokens(name, body);
  return (
    <form id={formId} className="app-form cskill-form" onSubmit={submit} noValidate>
      <TextField
        ref={nameRef}
        label="Name"
        value={name}
        maxLength={SKILL_NAME_MAX}
        onChange={(e) => {
          setName(e.target.value);
          clear("name");
        }}
        placeholder="House commit style"
        error={errors.name}
        hint="Shown in lists and in each cat's mind panel"
      />
      <TextField
        label="Summary"
        value={summary}
        maxLength={SKILL_SUMMARY_MAX}
        onChange={(e) => {
          setSummary(e.target.value);
          clear("summary");
        }}
        placeholder="Conventional commits, small pull requests"
        error={errors.summary}
        hint="Optional. One line for lists; left empty, the first line of the text."
      />
      <div className="field">
        <div className="cskill-label-row">
          <label htmlFor={bodyId}>Instructions</label>
          <span className="cskill-count num" id={countId} data-state={over > 0 ? "over" : undefined}>
            {fmtInt(body.length)} of {fmtInt(SKILL_BODY_MAX)}
          </span>
        </div>
        <textarea
          ref={bodyRef}
          id={bodyId}
          className="cskill-body-input"
          rows={8}
          value={body}
          spellCheck
          onChange={(e) => {
            setBody(e.target.value);
            clear("body");
          }}
          placeholder={"Write it the way you would brief a new teammate.\n- Use the pnpm scripts in this repo.\n- Keep every commit small."}
          aria-invalid={bodyError ? true : undefined}
          aria-describedby={`${hintId} ${countId}`}
        />
        <p className="field-hint" id={hintId} data-state={bodyError ? "error" : undefined} aria-live={bodyError ? "polite" : undefined}>
          {bodyError ?? (tokens ? `About ${plural(tokens, "token")} in every matching cat's prompt. Markdown works.` : `Markdown works. A cat reads at most ${fmtInt(SKILL_BODY_MAX)} characters.`)}
        </p>
      </div>
      <ScopeChecks<AgentRole>
        legend="Who reads it"
        everyLabel="Every role"
        everyOn="Every cat on the crew reads it."
        everyOff="Only the roles you tick below."
        every={everyRole}
        onEvery={(v) => {
          setEveryRole(v);
          clear("roles");
        }}
        options={SKILL_ROLES}
        value={roles}
        onChange={(next) => {
          setRoles(next);
          clear("roles");
        }}
        word={roleWord}
        hint="Roles you leave out never see it."
        error={errors.roles}
      />
      <ScopeChecks<CompanyKind>
        legend="Which companies"
        everyLabel="Every company"
        everyOn="Software studios and hedge funds alike."
        everyOff="Only the kinds you tick below."
        every={everyKind}
        onEvery={(v) => {
          setEveryKind(v);
          clear("kinds");
        }}
        options={SKILL_KINDS}
        value={kinds}
        onChange={(next) => {
          setKinds(next);
          clear("kinds");
        }}
        word={(k) => COMPANY_WORD[k]}
        hint="A run's company kind is picked when it starts."
        error={errors.kinds}
      />
      <Switch
        label="Enabled"
        description={enabled ? "Matching cats read it from their next step." : "Saved, but no cat reads it until you switch it on."}
        checked={enabled}
        onChange={setEnabled}
      />
      <FormStatus error={save.error} />
    </form>
  );
}

/** The side sheet that holds the form: Cancel and Save in its footer, a scrim tap never drops a draft. */
function SkillSheet({ open, editing, all, onSaved, onClose }: { open: boolean; editing: CrewSkillDTO | null; all: CrewSkillDTO[]; onSaved: (s: CrewSkillDTO, created: boolean) => void; onClose: () => void }) {
  const formId = useId();
  const [busy, setBusy] = useState(false);
  return (
    <Drawer
      open={open}
      onClose={onClose}
      dismissible={false}
      title={editing ? `Edit ${editing.name}` : "Write a skill"}
      description={editing ? "Matching cats read the new text from their next step." : "Your stack, house rules, how you like things done. Every matching cat reads it next to its charter."}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form={formId} aria-busy={busy || undefined}>
            <ProductIcon name={editing ? "check" : "plus"} size={20} />
            <span>{editing ? "Save changes" : "Save skill"}</span>
          </button>
        </>
      }
    >
      <SkillForm formId={formId} editing={editing} all={all} onSaved={onSaved} onBusy={setBusy} />
    </Drawer>
  );
}

function LearnedSkills() {
  const { api } = useApp();
  const skills = useResource((signal) => api.call("GET /api/memory/skills", { signal }), "skills");
  const del = useAction();
  const list = skills.data ?? [];
  return (
    <Region container="divided" title="Learned by the crew" meta="Tool sequences a cat saved because they worked. Cats replay them instead of working it out again.">
      {skills.error ? (
        <EmptyState
          icon="alertCircle"
          tone="danger"
          title="Learned skills did not load"
          action={
            <button type="button" onClick={skills.reload}>
              Try again
            </button>
          }
        >
          {skills.error}
        </EmptyState>
      ) : skills.loading && !skills.data ? (
        <SkeletonRows rows={2} label="Loading learned skills" />
      ) : list.length === 0 ? (
        <p className="app-empty-line">Nothing saved yet. A cat saves a recipe after a run of tool calls that worked.</p>
      ) : (
        <ul className="skill-list">
          {list.map((s) => (
            <li className="skill-row" key={s.id}>
              <span className="skill-body">
                <span className="skill-name">{s.name}</span>
                <span className="skill-desc">{s.description}</span>
                <span className="lesson-meta">
                  <span>{s.role ? `${roleWord(s.role)} cats` : "Every cat"}</span>
                  <span>
                    {plural(s.steps.length, "step")}: <span className="num">{s.steps.map((x) => x.tool).join(", ")}</span>
                  </span>
                  <span>
                    Won <span className="num">{s.wins}</span> of <span className="num">{s.uses}</span>
                  </span>
                </span>
              </span>
              <button
                type="button"
                className="btn-ghost"
                aria-label={`Delete learned skill ${s.name}`}
                disabled={del.busy}
                onClick={() =>
                  void del.run(async () => {
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
  );
}

export function SkillsScreen() {
  const { api } = useApp();
  const now = useNow(60_000);
  const [loadErr, setLoadErr] = useState<unknown>(null);
  const written = useResource(
    (signal) =>
      api.call("GET /api/crew-skills", { signal }).catch((e: unknown) => {
        setLoadErr(e);
        throw e;
      }),
    "crew-skills",
  );
  // null: the sheet is closed; { skill: null } writes a new one
  const [sheet, setSheet] = useState<{ skill: CrewSkillDTO | null } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [removing, setRemoving] = useState<CrewSkillDTO | null>(null);
  const remove = useAction();

  const missing = !!written.error && loadErr instanceof ApiError && (loadErr.status === 404 || loadErr.status === 501);
  const all = written.data ?? [];
  const builtins = all.filter((s) => s.source === "builtin");
  const mine = all.filter((s) => s.source === "owner");
  const builtinsOn = builtins.filter((s) => s.enabled);
  const mineOn = mine.filter((s) => s.enabled).length;
  const loading = written.loading && !written.data;
  const ready = !loading && !written.error;

  const upsert = (s: CrewSkillDTO) => written.setData((prev) => (prev?.some((x) => x.id === s.id) ? prev.map((x) => (x.id === s.id ? s : x)) : [...(prev ?? []), s]));

  const onSaved = (s: CrewSkillDTO, created: boolean) => {
    upsert(s);
    setSaved(`${s.name} ${created ? "saved" : "updated"}. ${s.enabled ? "Matching cats read it from their next step." : "It stays off until you switch it on."}`);
    setSheet(null);
  };
  const openSheet = (skill: CrewSkillDTO | null) => {
    setSaved(null);
    setSheet({ skill });
  };

  let builtinBody: ReactNode;
  if (loading) builtinBody = <SkeletonRows rows={4} label="Loading the built-in skills" />;
  else if (missing)
    builtinBody = (
      <EmptyState icon="fileText" title="Written skills are not on this engine yet">
        Update MengAI and the built-in pack shows here, with your own skills below it. The learned recipes still work.
      </EmptyState>
    );
  else if (written.error)
    builtinBody = (
      <EmptyState
        icon="alertCircle"
        tone="danger"
        title="Skills did not load"
        action={
          <button type="button" onClick={written.reload}>
            Try again
          </button>
        }
      >
        {written.error}
      </EmptyState>
    );
  else if (builtins.length === 0) builtinBody = <p className="app-empty-line">This build ships no built-in skills.</p>;
  else
    builtinBody = (
      <ul className="cskill-list" aria-label="Built-in skills">
        {builtins.map((s) => (
          <BuiltinRow key={s.id} skill={s} onChange={upsert} />
        ))}
      </ul>
    );

  const tokensOn = builtinsOn.reduce((n, s) => n + s.tokens, 0);
  const builtinMeta = (
    <>
      Ships with MengAI and updates with the app: design law and tidiness, UI taste, the design system, motion, architecture, security and QA habits, on whatever stack your project uses. Each cat reads the ones that fit its role and the goal. You can switch a skill off, not edit it.
      {builtins.length ? (
        <>
          {" "}
          <span className="num">{fmtInt(builtinsOn.length)}</span> of <span className="num">{fmtInt(builtins.length)}</span> on, <span className="num">{fmtInt(tokensOn)}</span> tokens in all.
        </>
      ) : null}
    </>
  );

  return (
    <Page>
      <PageHead
        title="Skills"
        lead="Written skills are instructions a cat reads next to its role charter on every step. The built-in pack gives every crew a modern, tidy UI and sound engineering habits whatever model runs it; your own skills add the rules of your house."
      />

      <Region container="divided" title="Built in" meta={builtinMeta}>
        {builtinBody}
      </Region>

      {missing ? null : (
        <Region
          container="rows"
          title="Your skills"
          meta={ready && mine.length ? `${plural(mine.length, "skill")}, ${fmtInt(mineOn)} on. Only you can change them.` : "Only you can change them."}
          actions={
            ready ? (
              <button type="button" onClick={() => openSheet(null)}>
                <ProductIcon name="plus" size={20} />
                <span>Write a skill</span>
              </button>
            ) : undefined
          }
        >
          {loading ? (
            <SkeletonRows rows={2} label="Loading your skills" />
          ) : written.error ? (
            <p className="app-empty-line">Your skills show here once the list loads.</p>
          ) : mine.length === 0 ? (
            <EmptyState icon="fileText" title="No skills of your own yet">
              Write one for your stack, how you like commits, or what a finished screen means to you. Every matching cat reads it.
            </EmptyState>
          ) : (
            <ul className="p-rows" data-variant="boxed" aria-label="Your skills">
              {mine.map((s) => (
                <OwnerRow key={s.id} skill={s} now={now} onChange={upsert} onEdit={openSheet} onDelete={setRemoving} />
              ))}
            </ul>
          )}
          <FormStatus ok={saved} />
        </Region>
      )}

      <LearnedSkills />

      <SkillSheet open={!!sheet} editing={sheet?.skill ?? null} all={all} onSaved={onSaved} onClose={() => setSheet(null)} />

      <Sheet
        open={!!removing}
        onClose={() => setRemoving(null)}
        alert
        dismissible={false}
        title={removing ? `Delete ${removing.name}?` : "Delete the skill?"}
        description="Cats stop reading it from their next step. This cannot be undone."
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setRemoving(null)}>
              Keep it
            </button>
            <button
              type="button"
              className="app-btn-destructive"
              aria-busy={remove.busy || undefined}
              onClick={() =>
                void remove.run(async () => {
                  if (!removing) return;
                  await api.call("DELETE /api/crew-skills/:id", { params: { id: removing.id } });
                  written.setData((prev) => (prev ?? []).filter((x) => x.id !== removing.id));
                  setSaved(`${removing.name} deleted. Cats stop reading it from their next step.`);
                  setRemoving(null);
                })
              }
            >
              Delete
            </button>
          </>
        }
      >
        <p className="app-body-muted">{removing ? `${plural(removing.tokens, "token")} leave the prompt of every cat that read it.` : null}</p>
        <FormStatus error={remove.error} />
      </Sheet>
    </Page>
  );
}

// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Home (/app): what is live, a new run with its estimate and budget beside
// the runs it creates, the projects the crew may touch (each with Open
// folder, and an add form under them: the engine has no native folder
// picker, so a folder is named by its path), and the company itself:
// every role on the crew, what it does, its tools and its model.
// Regions and containers per JEV ui.region_gate (head plain, setup plain,
// live card, new run card, runs rows, projects divided, the add form in
// plain spacing inside it at 0.58, company rows).
import { Cat } from "@mengai/cats";
import {
  ACTIVITY_LABEL,
  AGENT_ROLES,
  ROLE_LABEL,
  ROLE_TOOLS,
  leadCatName,
  type Activity,
  type AgentRole,
  type CompanyKind,
  type ModelRouting,
  type ProjectDTO,
  type RunDTO,
  type RunEstimate,
  type RunSnapshotDTO,
  type Tier,
} from "@mengai/shared";
import { DataRow, DataRows, EmptyState, Meter, Notice, ProductIcon, SkeletonRows, StatusPill } from "@mengai/ui/src/product";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, navigate } from "../../router";
import { withCrewLooks } from "../../store/looks";
import { tokensUsed } from "../../store/runStore";
import { useApp } from "../context";
import { fmtAgo, fmtInt, fmtUsd } from "../format";
import { useAction, useNow, useResource } from "../hooks";
import { RUN_STATUS, isFinished } from "../status";
import { COMPANY_WORD } from "../run/stages";
import { OpenFolderButton } from "../parts/OpenFolder";
import { FormStatus, Page, PageHead, RadioGroup, Region, SelectField, TextArea, TextField } from "../ui";

const ROLE_JOB: Record<AgentRole, string> = {
  lead: "Turns your goal into a task graph, hands out the work and writes the final report.",
  engineer: "Reads and writes code in the workspace and runs commands in its sandbox.",
  designer: "Designs screens and their states, and makes images with your media model.",
  reviewer: "Reads every change, runs the tests itself, then passes it or sends it back.",
  qa: "Writes tests against real fixtures and runs the whole suite.",
  security: "Scans for committed secrets, unsafe dependencies and risky config.",
  researcher: "Reads the web for answers when you allow network tools.",
  operator: "Would operate apps on your Mac. It sits this build out.",
};

const ROLE_POSE: Record<AgentRole, Activity> = {
  lead: "plan",
  engineer: "code",
  designer: "design",
  reviewer: "review",
  qa: "run",
  security: "scan",
  researcher: "research",
  operator: "rest",
};

const ROLE_COAT: Record<AgentRole, { coat: string; seed: number }> = {
  lead: { coat: "ginger", seed: 1204 },
  engineer: { coat: "tuxedo", seed: 88213 },
  designer: { coat: "calico", seed: 5530 },
  reviewer: { coat: "gray", seed: 71002 },
  qa: { coat: "black", seed: 3319 },
  security: { coat: "siamese", seed: 90417 },
  researcher: { coat: "tabby", seed: 44120 },
  operator: { coat: "cream", seed: 20981 },
};

const TIER_WORD: Record<Tier, string> = { fast: "Fast", balanced: "Balanced", deep: "Deep" };

function modelFor(routing: ModelRouting | null, tier: Tier): string {
  const hit = routing?.tiers.find((t) => t.tier === tier);
  return hit?.model ?? "Automatic";
}

function LiveRun({ run, snap, project, still, ceo }: { run: RunDTO; snap: RunSnapshotDTO | null; project: ProjectDTO | null; still: boolean; ceo: string }) {
  const look = RUN_STATUS[run.status];
  const used = tokensUsed(run.usage);
  const tasks = snap?.tasks.filter((t) => t.status !== "cancelled") ?? [];
  const done = tasks.filter((t) => t.status === "done").length;
  const agents = snap
    ? withCrewLooks(snap.agents).sort((a, b) => (a.role === "lead" ? -1 : b.role === "lead" ? 1 : a.createdAt - b.createdAt))
    : [];
  const asking = agents.filter((a) => a.status === "approval");
  return (
    <Link className="live-card" href={`/app/runs/${encodeURIComponent(run.id)}`} aria-label={`Open the run: ${run.goal}`}>
      <span className="live-top">
        <span className="live-goal">{run.goal}</span>
        <span className="live-meta">
          <StatusPill tone={look.tone} icon={look.icon}>
            {look.word}
          </StatusPill>
          {project ? <span className="num">{project.name}</span> : null}
          {tasks.length ? (
            <span>
              <span className="num">{done}</span> of <span className="num">{tasks.length}</span> tasks done
            </span>
          ) : null}
          {asking.length ? (
            <span className="live-asking">
              <ProductIcon name="alertTriangle" size={16} />
              <span>{asking.map((a) => a.name).join(" and ")} needs you</span>
            </span>
          ) : null}
        </span>
      </span>
      {agents.length > 0 ? (
        <span className="live-crew" aria-label="The crew">
          {agents.map((a) => (
            <span className="live-cat" key={a.id}>
              <Cat look={a.look} role={a.role} status={a.status} activity={a.activity} mood={a.mood} label={`${a.name}, ${ROLE_LABEL[a.role]}`} size={48} still={still} />
              <span className="live-cat-name">{a.name}</span>
              <span className="live-cat-doing" title={a.status === "approval" ? "Needs you" : ACTIVITY_LABEL[a.activity]}>
                {a.status === "approval" ? "Needs you" : ACTIVITY_LABEL[a.activity]}
              </span>
            </span>
          ))}
        </span>
      ) : (
        <span className="live-empty">The crew is stretching. {ceo} joins as soon as the run starts.</span>
      )}
      <span className="live-foot">
        <span className="live-meter">
          <Meter label="Budget used" value={run.budgetTokens ? used / run.budgetTokens : 0} valueText={run.budgetTokens ? `${fmtInt(used)} of ${fmtInt(run.budgetTokens)} tokens` : `${fmtInt(used)} tokens, no cap`} />
        </span>
        <span className="live-open">
          <span>Open the run</span>
          <ProductIcon name="chevronRight" size={20} />
        </span>
      </span>
    </Link>
  );
}

function NewRun({ projects, focus }: { projects: ProjectDTO[]; focus: boolean }) {
  const { api, settings } = useApp();
  const [projectId, setProjectId] = useState<string>("");
  const [goal, setGoal] = useState("");
  const [tokens, setTokens] = useState<string>("");
  const [usd, setUsd] = useState<string>("");
  const [estimate, setEstimate] = useState<RunEstimate | null>(null);
  const [goalError, setGoalError] = useState<string | null>(null);
  const [company, setCompany] = useState<CompanyKind>("studio");
  const ceo = leadCatName(settings?.ceoName);
  const est = useAction();
  const start = useAction();
  const goalRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projects, projectId]);
  useEffect(() => {
    if (focus) goalRef.current?.focus();
  }, [focus]);

  // 0 is a real choice: no cap. An empty field takes the default from Settings.
  const tokenDigits = tokens.replace(/[^0-9]/g, "");
  const usdDigits = usd.replace(/[^0-9.]/g, "");
  const budgetTokens = tokenDigits ? Number(tokenDigits) : (settings?.defaultBudgetTokens ?? 400_000);
  const budgetUsd = usdDigits && Number.isFinite(Number(usdDigits)) ? Number(usdDigits) : (settings?.defaultBudgetUsd ?? 5);
  const uncapped = [budgetTokens === 0 ? "tokens" : null, budgetUsd === 0 ? "cost" : null].filter(Boolean) as string[];

  const runEstimate = () =>
    est.run(async () => {
      if (!goal.trim() || !projectId) {
        setGoalError(goal.trim() ? null : "Describe the goal first, one or two sentences is plenty.");
        return;
      }
      setEstimate(await api.call("POST /api/runs/estimate", { body: { projectId, goal: goal.trim() } }));
    });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!goal.trim()) {
      setGoalError("Describe the goal first, one or two sentences is plenty.");
      goalRef.current?.focus();
      return;
    }
    void start.run(async () => {
      const run = await api.call("POST /api/runs", { body: { projectId, goal: goal.trim(), budgetTokens, budgetUsd, company } });
      navigate(`/app/runs/${encodeURIComponent(run.id)}`);
    });
  };

  return (
    <section className="app-region app-card newrun" data-container="card" aria-labelledby="new-run-h" id="new-run">
      <div className="app-region-head">
        <div className="app-region-text">
          <h2 className="app-h2" id="new-run-h">
            New run
          </h2>
          <p className="app-region-meta">See the tasks, tokens and cost before a single cat starts.</p>
        </div>
      </div>
      <form className="app-form" onSubmit={submit} noValidate>
        <div className="newrun-project">
          <SelectField label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)} hint={projects.find((p) => p.id === projectId)?.workspacePath ?? "Add the folder the crew may work in"} disabled={projects.length === 0}>
            {projects.length === 0 ? <option value="">No project yet</option> : null}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>
          <a className="btn btn-secondary newrun-folder" href="#add-project">
            <ProductIcon name="folder" size={20} />
            <span>Add a project</span>
          </a>
        </div>
        <RadioGroup<CompanyKind>
          legend="Company"
          name="company-kind"
          value={company}
          onChange={setCompany}
          options={[
            { value: "studio", label: COMPANY_WORD.studio, description: `${ceo} hires engineers, a reviewer and QA to build, review and ship code in your project.` },
            { value: "fund", label: COMPANY_WORD.fund, description: "The crew researches, backtests and trades on paper first; a live order waits for you." },
          ]}
        />
        <TextArea
          ref={goalRef}
          label="Goal"
          value={goal}
          onChange={(e) => {
            setGoal(e.target.value);
            setEstimate(null);
            if (goalError) setGoalError(null);
          }}
          placeholder={company === "fund" ? "Test a momentum thesis on the top 20 US tech stocks, paper only" : "Add a CSV export to the daily sales report, with tests"}
          rows={3}
          maxLength={4000}
          error={goalError}
          hint={`Say what done looks like. ${ceo} turns it into tasks.`}
        />
        <div className="field-row">
          <TextField
            label="Token budget"
            inputMode="numeric"
            value={tokens}
            placeholder={settings?.defaultBudgetTokens === 0 ? "0, no cap" : fmtInt(settings?.defaultBudgetTokens ?? 400_000)}
            onChange={(e) => setTokens(e.target.value)}
            hint={budgetTokens === 0 ? "0 means no cap" : "The run stops here. 0 means no cap."}
          />
          <TextField
            label="Cost budget in USD"
            inputMode="decimal"
            value={usd}
            placeholder={settings?.defaultBudgetUsd === 0 ? "0, no cap" : String(settings?.defaultBudgetUsd ?? 5)}
            onChange={(e) => setUsd(e.target.value)}
            hint={budgetUsd === 0 ? "0 means no cap" : "Billed to your own key. 0 means no cap."}
          />
        </div>
        {uncapped.length ? (
          <Notice tone="warning" title={uncapped.length === 2 ? "No token or cost cap" : `No ${uncapped[0]} cap`}>
            This run keeps spending on your own key until it finishes or you stop it. Stop all in the header always works.
          </Notice>
        ) : null}
        <div className="newrun-estimate" aria-live="polite">
          {estimate ? (
            <p className="newrun-estimate-text">
              About <span className="num">{estimate.tasks}</span> tasks, <span className="num">{fmtInt(estimate.tokens)}</span> tokens and <span className="num">{fmtUsd(estimate.costUsd)}</span>,{" "}
              {estimate.basis === "history" ? "from your past runs" : "a first guess until you have past runs"}.
              {budgetTokens > 0 && estimate.tokens > budgetTokens ? " That is over the token budget, so the run would stop early." : ""}
            </p>
          ) : (
            <p className="newrun-estimate-text" data-empty="">
              No estimate yet. It costs nothing to ask.
            </p>
          )}
        </div>
        <div className="app-form-actions">
          <button type="submit" aria-busy={start.busy || undefined} disabled={!projectId}>
            <ProductIcon name="play" size={20} />
            <span>Start the run</span>
          </button>
          <button type="button" className="btn-secondary" aria-busy={est.busy || undefined} onClick={runEstimate} disabled={!projectId}>
            Estimate the cost
          </button>
        </div>
        <FormStatus error={start.error ?? est.error} />
      </form>
    </section>
  );
}

export function HomeScreen({ hash }: { hash: string }) {
  const { api, catsStill, settings } = useApp();
  const ceo = leadCatName(settings?.ceoName);
  const now = useNow(60_000);
  const runs = useResource((signal) => api.call("GET /api/runs", { signal }), "runs");
  const projects = useResource((signal) => api.call("GET /api/projects", { signal }), "projects");
  const health = useResource((signal) => api.call("GET /api/health", { signal }), "health");
  const routing = useResource((signal) => api.call("GET /api/routing", { signal }), "routing");
  const liveRuns = (runs.data ?? []).filter((r) => !isFinished(r.status)).slice(0, 3);
  const liveKey = liveRuns.map((r) => r.id).join(",");
  const snaps = useResource(
    (signal) => Promise.all(liveRuns.map((r) => api.call("GET /api/runs/:id", { params: { id: r.id }, signal }).catch(() => null))),
    `snaps:${liveKey}`,
  );
  const projectById = new Map((projects.data ?? []).map((p) => [p.id, p]));
  const past = (runs.data ?? []).slice().sort((a, b) => b.createdAt - a.createdAt);
  const [newName, setNewName] = useState("");
  const [newPath, setNewPath] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [pathError, setPathError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const add = useAction();
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (hash === "#add-project") nameRef.current?.focus();
  }, [hash]);

  const addProject = (e: FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    const path = newPath.trim().replace(/(.)\/+$/, "$1");
    setAdded(null);
    setNameError(name ? null : "Give the project a name.");
    setPathError(path && !path.startsWith("/") ? "Use the full path, starting with a slash, like /Users/you/code/shop." : null);
    if (!name || (path && !path.startsWith("/"))) return;
    void add.run(async () => {
      const p = await api.call("POST /api/projects", { body: path ? { name, workspacePath: path } : { name } });
      projects.setData((prev) => [...(prev ?? []), p]);
      setNewName("");
      setNewPath("");
      setAdded(`${p.name} added. The crew works in ${p.workspacePath}.`);
    });
  };

  return (
    <Page>
      <PageHead title="Runs" lead="One goal in, a crew of cats on it. Every run keeps to the budget you set, on your own model keys." />

      {health.data && !health.data.configured ? (
        <section className="app-region setup-line" data-container="plain" aria-labelledby="setup-h">
          <span className="setup-icon">
            <ProductIcon name="providers" size={24} />
          </span>
          <div className="setup-text">
            <h2 className="app-h2" id="setup-h">
              The cats need a model key to think
            </h2>
            <p className="app-region-meta">Add any provider you already pay for, then pick the models your cats use.</p>
          </div>
          <Link className="btn" href="/app/providers">
            Add a provider
          </Link>
        </section>
      ) : null}

      <div className="app-split home-split">
        <div className="app-split-main">
          <Region container="card" title="Live now" className="live" meta={liveRuns.length ? `${liveRuns.length} ${liveRuns.length === 1 ? "run" : "runs"} working` : undefined}>
            {runs.loading && !runs.data ? (
              <SkeletonRows rows={2} label="Loading live runs" />
            ) : liveRuns.length === 0 ? (
              <p className="app-empty-line">No run is live. The crew is curled up, ready for a goal.</p>
            ) : (
              <div className="live-list">
                {liveRuns.map((r, i) => (
                  <LiveRun key={r.id} run={r} snap={snaps.data?.[i] ?? null} project={projectById.get(r.projectId) ?? null} still={catsStill} ceo={ceo} />
                ))}
              </div>
            )}
          </Region>

          <Region container="rows" title="Recent runs" meta={past.length ? `${past.length} ${past.length === 1 ? "run" : "runs"}` : undefined}>
            {runs.error ? (
              <EmptyState icon="alertCircle" tone="danger" title="Runs did not load" action={<button type="button" onClick={runs.reload}>Try again</button>}>
                {runs.error}
              </EmptyState>
            ) : runs.loading && !runs.data ? (
              <SkeletonRows rows={3} label="Loading runs" />
            ) : past.length === 0 ? (
              <EmptyState icon="runs" title="No runs yet">
                Describe a goal in New run and the crew gets to work.
              </EmptyState>
            ) : (
              <DataRows label="Recent runs">
                {past.map((r) => {
                  const look = RUN_STATUS[r.status];
                  const p = projectById.get(r.projectId);
                  return (
                    <DataRow
                      key={r.id}
                      href={`/app/runs/${encodeURIComponent(r.id)}`}
                      leading={
                        <span className="row-status" data-tone={look.tone}>
                          <ProductIcon name={look.icon} size={20} label={look.word} />
                        </span>
                      }
                      title={r.goal}
                      titleAttr={r.goal}
                      meta={
                        <>
                          <span>{look.word}</span>
                          {p ? <span className="num">{p.name}</span> : null}
                          <span>
                            <span className="num">{fmtInt(tokensUsed(r.usage))}</span> tokens
                          </span>
                          <span className="num">{fmtUsd(r.usage.costUsd)}</span>
                          <span>{fmtAgo(r.createdAt, now)}</span>
                        </>
                      }
                      trailing={<ProductIcon name="chevronRight" size={20} />}
                    />
                  );
                })}
              </DataRows>
            )}
          </Region>

          <Region container="divided" title="Projects" meta="Folders the crew may work in. Nothing outside them is touched.">
            {projects.loading && !projects.data ? (
              <SkeletonRows rows={2} label="Loading projects" />
            ) : (projects.data ?? []).length === 0 ? (
              <p className="app-empty-line">No projects yet. Add the folder the crew should work in.</p>
            ) : (
              <ul className="project-list">
                {(projects.data ?? []).map((p) => (
                  <li className="project-row" key={p.id}>
                    <span className="project-icon">
                      <ProductIcon name="folder" size={20} />
                    </span>
                    <span className="project-body">
                      <span className="project-name">{p.name}</span>
                      <span className="project-path" title={p.workspacePath}>
                        {p.workspacePath}
                      </span>
                    </span>
                    <span className="project-actions">
                      {p.lastRunId ? (
                        <Link className="btn btn-ghost project-last" href={`/app/runs/${encodeURIComponent(p.lastRunId)}`}>
                          Last run
                        </Link>
                      ) : null}
                      <OpenFolderButton projectId={p.id} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <form className="project-add" id="add-project" onSubmit={addProject} noValidate aria-labelledby="add-project-h">
              <h3 className="app-h3" id="add-project-h">
                Add a project
              </h3>
              <div className="field-row">
                <TextField ref={nameRef} label="Name" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={120} autoComplete="off" error={nameError} hint="What the crew calls it" />
                <TextField
                  label="Folder on this Mac"
                  className="num"
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  placeholder="/Users/you/code/shop"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoComplete="off"
                  error={pathError}
                  hint="Optional. Empty makes a fresh folder for it."
                />
              </div>
              <div className="app-form-actions">
                <button type="submit" className="btn-secondary" aria-busy={add.busy || undefined}>
                  <ProductIcon name="plus" size={20} />
                  <span>Add project</span>
                </button>
              </div>
              <FormStatus ok={added} error={add.error} />
            </form>
          </Region>
        </div>
        <div className="app-split-side">
          <NewRun projects={projects.data ?? []} focus={hash === "#new-run"} />
        </div>
      </div>

      <Region
        container="rows"
        title="The crew"
        className="company"
        meta="Eight roles, one company. Every cat gets only the tools its job needs and the model tier you route it to."
        actions={
          <Link className="btn btn-secondary" href="/app/providers#routing">
            Edit model routing
          </Link>
        }
      >
        <ul className="company-list">
          {AGENT_ROLES.map((role) => {
            const override = routing.data?.roleTiers[role];
            const tier: Tier = override ?? "balanced";
            const off = role === "operator";
            return (
              <li className="company-row" key={role} data-off={off ? "" : undefined}>
                <span className="company-cat">
                  <Cat
                    look={ROLE_COAT[role]}
                    role={role}
                    status={off ? "stopped" : "working"}
                    activity={ROLE_POSE[role]}
                    mood="calm"
                    label={`${ROLE_LABEL[role]} cat`}
                    size={48}
                    still
                  />
                </span>
                <span className="company-body">
                  <span className="company-role">
                    {ROLE_LABEL[role]}
                    {role === "lead" ? <span className="company-name">{ceo}</span> : null}
                  </span>
                  <span className="company-job">{ROLE_JOB[role]}</span>
                </span>
                <span className="company-facts">
                  {off ? (
                    <StatusPill tone="neutral" icon="minusCircle">
                      Not in this build
                    </StatusPill>
                  ) : (
                    <>
                      <span>
                        <span className="num">{ROLE_TOOLS[role].length}</span> tools
                      </span>
                      <span>{override ? `Always ${TIER_WORD[override].toLowerCase()}` : "Tier picked per task"}</span>
                      <span className="num company-model" title={override ? undefined : "The balanced tier model, used when no tier is picked"}>
                        {modelFor(routing.data, tier)}
                      </span>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </Region>
    </Page>
  );
}

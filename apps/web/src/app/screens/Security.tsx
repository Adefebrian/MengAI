// Security (/app/security): scan a project, then triage what Cilok found.
// The page head was dropped by JEV (relevance 1.23), so the title is for
// assistive tech only. New scan (card) beside the scans (rows, the
// runner-up because divided matched the findings next to it), then the
// findings of the selected scan in one divided group per severity.
import { SCAN_KINDS, SEVERITIES, type FindingDTO, type FindingStatus, type ScanDTO, type ScanKind } from "@mengai/shared";
import { EmptyState, ProductIcon, SkeletonRows, StatusPill } from "@mengai/ui/src/product";
import { useEffect, useState, type FormEvent } from "react";
import { useApp } from "../context";
import { fmtAgo } from "../format";
import { useAction, useNow, useResource } from "../hooks";
import { FINDING_STATUS, JOB_STATUS, SEVERITY } from "../status";
import { Checkbox, FormStatus, Page, Region, ScreenTitle, SelectField } from "../ui";

const KIND_WORD: Record<ScanKind, { name: string; what: string }> = {
  deps: { name: "Dependencies", what: "Advisories in bun.lock (needs network tools)" },
  secrets: { name: "Secrets", what: "Keys and tokens committed to files" },
  config: { name: "Config", what: "Risky server and CORS settings" },
  review: { name: "Code review", what: "A read of the diff for unsafe patterns" },
};

function counts(s: ScanDTO): string {
  const parts = SEVERITIES.filter((v) => s.counts[v] > 0).map((v) => `${s.counts[v]} ${SEVERITY[v].word.toLowerCase()}`);
  return parts.length ? parts.join(", ") : "Nothing found";
}

function FindingRow({ f, onChange }: { f: FindingDTO; onChange: (f: FindingDTO) => void }) {
  const { api } = useApp();
  const act = useAction();
  const look = SEVERITY[f.severity];
  return (
    <li className="finding-row">
      <span className="finding-body">
        <span className="finding-title">
          <StatusPill tone={look.tone} icon={look.icon}>
            {look.word}
          </StatusPill>
          <span>{f.title}</span>
        </span>
        <span className="finding-where num">
          {f.file ?? "Project"}
          {f.line ? `:${f.line}` : ""} <span className="finding-rule">{f.rule}</span>
        </span>
        <span className="finding-detail num">{f.detail}</span>
        {f.fix ? <span className="finding-fix">Fix: {f.fix}</span> : null}
        <FormStatus error={act.error} />
      </span>
      <span className="finding-status">
        <SelectField
          label="Status"
          value={f.status}
          disabled={act.busy}
          onChange={(e) => {
            const status = e.target.value as FindingStatus;
            void act.run(async () => onChange(await api.call("PATCH /api/security/findings/:id", { params: { id: f.id }, body: { status } })));
          }}
        >
          {(Object.keys(FINDING_STATUS) as FindingStatus[]).map((s) => (
            <option key={s} value={s}>
              {FINDING_STATUS[s]}
            </option>
          ))}
        </SelectField>
      </span>
    </li>
  );
}

export function SecurityScreen() {
  const { api, settings } = useApp();
  const now = useNow(60_000);
  const projects = useResource((signal) => api.call("GET /api/projects", { signal }), "projects");
  const scans = useResource((signal) => api.call("GET /api/security/scans", { signal }), "scans");
  const [selected, setSelected] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");
  const [kinds, setKinds] = useState<ScanKind[]>(["deps", "secrets", "config"]);
  const [ok, setOk] = useState<string | null>(null);
  const start = useAction();
  const list = (scans.data ?? []).slice().sort((a, b) => b.createdAt - a.createdAt);
  const current = selected ?? list[0]?.id ?? null;
  const findings = useResource((signal) => (current ? api.call("GET /api/security/scans/:id/findings", { params: { id: current }, signal }) : Promise.resolve([] as FindingDTO[])), `findings:${current}`);
  const projectName = new Map((projects.data ?? []).map((p) => [p.id, p.name]));

  useEffect(() => {
    if (!projectId && projects.data?.[0]) setProjectId(projects.data[0].id);
  }, [projects.data, projectId]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setOk(null);
    void start.run(async () => {
      if (kinds.length === 0) throw new Error("Pick at least one thing to check.");
      const s = await api.call("POST /api/security/scans", { body: { projectId, kinds } });
      scans.setData((prev) => [s, ...(prev ?? [])]);
      setSelected(s.id);
      setOk("Scan queued. Cilok is on it.");
    });
  };

  const scan = list.find((s) => s.id === current) ?? null;
  const items = findings.data ?? [];

  return (
    <Page>
      <ScreenTitle>Security</ScreenTitle>
      <div className="app-split sec-split">
        <div className="app-split-side">
          <Region container="card" title="New scan" className="app-card" meta="The security cat checks the project folder; nothing leaves it unless network tools are on.">
            <form className="app-form" onSubmit={submit} noValidate>
              <SelectField label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={!projects.data?.length}>
                {(projects.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </SelectField>
              <fieldset className="app-checks">
                <legend className="field-label">Check for</legend>
                {SCAN_KINDS.map((k) => (
                  <Checkbox
                    key={k}
                    label={KIND_WORD[k].name}
                    description={k === "deps" && settings && !settings.allowNetworkTools ? "Needs network tools, which are off in Settings" : KIND_WORD[k].what}
                    checked={kinds.includes(k)}
                    onChange={(on) => setKinds((prev) => (on ? [...prev, k] : prev.filter((x) => x !== k)))}
                  />
                ))}
              </fieldset>
              <div className="app-form-actions">
                <button type="submit" aria-busy={start.busy || undefined} disabled={!projectId}>
                  <ProductIcon name="scan" size={20} />
                  <span>Start the scan</span>
                </button>
              </div>
              <FormStatus ok={ok} error={start.error} />
            </form>
          </Region>
        </div>
        <div className="app-split-main">
          <Region container="rows" title="Scans" meta={list.length ? `${list.length} ${list.length === 1 ? "scan" : "scans"}` : undefined}>
            {scans.loading && !scans.data ? (
              <SkeletonRows rows={2} label="Loading scans" />
            ) : list.length === 0 ? (
              <p className="app-empty-line">No scans yet. Start one and Cilok sniffs through the project.</p>
            ) : (
              <ul className="p-rows" data-variant="boxed" aria-label="Scans">
                {list.map((s) => {
                  const look = JOB_STATUS[s.status];
                  return (
                    <li className="p-rows-item" key={s.id}>
                      <button type="button" className="p-row" data-type="button" aria-pressed={s.id === current} data-selected={s.id === current ? "" : undefined} onClick={() => setSelected(s.id)}>
                        <span className="p-row-leading row-status" data-tone={look.tone}>
                          <ProductIcon name={look.icon} size={20} label={look.word} />
                        </span>
                        <span className="p-row-text">
                          <span className="p-row-title">{counts(s)}</span>
                          <span className="p-row-meta">
                            <span>{look.word}</span>
                            <span className="num">{projectName.get(s.projectId) ?? "Project"}</span>
                            <span>{s.kinds.map((k) => KIND_WORD[k].name.toLowerCase()).join(", ")}</span>
                            <span>{fmtAgo(s.createdAt, now)}</span>
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Region>
        </div>
      </div>

      <Region container="divided" title="Findings" meta={scan ? `${counts(scan)} in the scan from ${fmtAgo(scan.createdAt, now)}` : undefined}>
        {!scan ? (
          <p className="app-empty-line">Pick a scan to see what it found.</p>
        ) : findings.loading && !findings.data ? (
          <SkeletonRows rows={2} label="Loading findings" />
        ) : findings.error ? (
          <EmptyState icon="alertCircle" tone="danger" title="Findings did not load" action={<button type="button" onClick={findings.reload}>Try again</button>}>
            {findings.error}
          </EmptyState>
        ) : items.length === 0 ? (
          <p className="app-empty-line">{scan.status === "done" ? "Clean. Cilok found nothing in this scan." : "Still scanning. Findings land here as they come in."}</p>
        ) : (
          <div className="lesson-groups">
            {SEVERITIES.map((sev) => {
              const group = items.filter((f) => f.severity === sev);
              if (!group.length) return null;
              return (
                <div className="lesson-group" key={sev}>
                  <p className="task-group-label">
                    <span>{SEVERITY[sev].word}</span>
                    <span className="num">{group.length}</span>
                  </p>
                  <ul className="lesson-list">
                    {group.map((f) => (
                      <FindingRow key={f.id} f={f} onChange={(next) => findings.setData((prev) => (prev ?? []).map((x) => (x.id === next.id ? next : x)))} />
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </Region>
    </Page>
  );
}

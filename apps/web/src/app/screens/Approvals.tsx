// Approvals (/app/approvals): every request a cat waits on, the standing
// rule per workspace capability, and what was decided before. Regions per
// JEV ui.region_gate: head plain, pending divided (each request an
// actionable notification), permissions card, history divided. Local
// computer control (input, screen, apps) is not part of this build, so
// only files, shell and network have a rule here.
import type { ApprovalDTO, Capability, PermissionDTO, PermissionMode } from "@mengai/shared";
import { EmptyState, SkeletonRows, StatusPill } from "@mengai/ui/src/product";
import { useApp } from "../context";
import { fmtAgo } from "../format";
import { useAction, useNow, useResource } from "../hooks";
import { ApprovalNotice } from "../parts/ApprovalNotice";
import { APPROVAL_STATUS } from "../status";
import { FormStatus, Page, PageHead, Region, Segmented } from "../ui";

const RULED: Array<{ cap: Capability; name: string; what: string }> = [
  { cap: "fs", name: "Files", what: "Reading and writing inside the project folder" },
  { cap: "shell", name: "Shell", what: "Commands in the sandbox, like bun test or bun add" },
  { cap: "network", name: "Network", what: "Web research and dependency audits" },
];

const MODE_WORD: Record<PermissionMode, string> = { off: "Off", ask: "Ask me", auto_read: "Auto for reads" };

function Rule({ rule, grant, onSaved }: { rule: (typeof RULED)[number]; grant: PermissionDTO | undefined; onSaved: (g: PermissionDTO) => void }) {
  const { api } = useApp();
  const save = useAction();
  return (
    <div className="rule-row">
      <p className="rule-name">
        <span>{rule.name}</span>
        <span className="rule-what">{rule.what}</span>
      </p>
      <Segmented<PermissionMode>
        legend={`${rule.name} rule`}
        name={`rule-${rule.cap}`}
        value={grant?.mode ?? "off"}
        options={(["off", "ask", "auto_read"] as const).map((m) => ({ value: m, label: MODE_WORD[m] }))}
        disabled={save.busy}
        onChange={(mode) =>
          void save.run(async () => {
            onSaved(await api.call("PUT /api/automation/grants/:capability", { params: { capability: rule.cap }, body: { mode } }));
          })
        }
      />
      <FormStatus error={save.error} />
    </div>
  );
}

export function ApprovalsScreen() {
  const { api, refreshApprovals } = useApp();
  const now = useNow(30_000);
  const list = useResource((signal) => api.call("GET /api/automation/approvals", { signal }), "approvals");
  const grants = useResource((signal) => api.call("GET /api/automation/grants", { signal }), "grants");
  const all = list.data ?? [];
  const pending = all.filter((a) => a.status === "pending");
  const past = all.filter((a) => a.status !== "pending").sort((a, b) => (b.decidedAt ?? b.createdAt) - (a.decidedAt ?? a.createdAt));

  const decide = async (a: ApprovalDTO, decision: "approve" | "deny", scope: "once" | "session") => {
    const next = await api.call("POST /api/automation/approvals/:id", { params: { id: a.id }, body: { decision, scope } });
    list.setData((prev) => (prev ?? []).map((x) => (x.id === next.id ? next : x)));
    refreshApprovals();
  };

  return (
    <Page>
      <PageHead
        title="Approvals"
        lead={
          list.data
            ? pending.length
              ? `${pending.length} ${pending.length === 1 ? "request waits" : "requests wait"} on you. A cat asks before it does anything risky outside its task.`
              : "Nothing waits on you. Every cat has what it needs."
            : "What the crew asks before it does anything risky."
        }
      />

      <Region container="divided" title="Waiting on you" meta={pending.length ? undefined : "When a cat needs a yes, it lands here and on the run."}>
        {list.error ? (
          <EmptyState icon="alertCircle" tone="danger" title="Approvals did not load" action={<button type="button" onClick={list.reload}>Try again</button>}>
            {list.error}
          </EmptyState>
        ) : list.loading && !list.data ? (
          <SkeletonRows rows={2} label="Loading approvals" />
        ) : pending.length === 0 ? (
          <p className="app-empty-line">All quiet. No paw is raised.</p>
        ) : (
          <div className="pending-list">
            {pending.map((a) => (
              <ApprovalNotice key={a.id} approval={a} who={null} onDecide={decide} />
            ))}
          </div>
        )}
      </Region>

      <Region container="card" title="Standing rules" className="app-card rules" meta="Destructive and sensitive actions always ask, whatever the rule says.">
        {grants.data ? (
          <div className="rule-list">
            {RULED.map((r) => (
              <Rule key={r.cap} rule={r} grant={grants.data!.find((g) => g.capability === r.cap)} onSaved={(g) => grants.setData((prev) => (prev ?? []).map((x) => (x.capability === g.capability ? g : x)).concat((prev ?? []).some((x) => x.capability === g.capability) ? [] : [g]))} />
            ))}
          </div>
        ) : grants.error ? (
          <p className="app-empty-line" role="alert">
            {grants.error}
          </p>
        ) : (
          <SkeletonRows rows={3} label="Loading rules" />
        )}
      </Region>

      <Region container="divided" title="Decided" meta={past.length ? `${past.length} earlier ${past.length === 1 ? "request" : "requests"}` : undefined}>
        {past.length === 0 ? (
          <p className="app-empty-line">No decisions yet.</p>
        ) : (
          <ul className="history-list">
            {past.map((a) => {
              const look = APPROVAL_STATUS[a.status];
              return (
                <li className="history-row" key={a.id}>
                  <StatusPill tone={look.tone} icon={look.icon}>
                    {look.word}
                  </StatusPill>
                  <span className="history-title">{a.title}</span>
                  <span className="history-meta">
                    <span>{a.scope === "session" ? "For the session" : "Once"}</span>
                    <span>{fmtAgo(a.decidedAt ?? a.createdAt, now)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Region>
    </Page>
  );
}

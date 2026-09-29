// A request that blocks a cat (JEV ui.component_recipe
// core.notification.actionable; on the run screen it rises in with an.R01,
// 0.97): the warning surface with one full hairline, an icon and a title
// that names the state, the asking cat itself with its paw up (its live
// status, activity and mood, so the cats package poses the ask), the exact
// thing that will run in mono, when it expires, and the three answers.
// Approve once is the one filled action.
import { Cat } from "@mengai/cats";
import { ROLE_LABEL, type AgentDTO, type ApprovalDTO } from "@mengai/shared";
import { Notice, ProductIcon } from "@mengai/ui/src/product";
import { useAction, useNow } from "../hooks";
import { fmtDuration } from "../format";
import { RISK } from "../status";

const CAPABILITY: Record<ApprovalDTO["capability"], string> = {
  fs: "Files",
  shell: "Shell",
  browser: "Browser",
  input: "Keyboard and mouse",
  screen: "Screen",
  apps: "Apps",
  network: "Network",
};

/** The one line that says exactly what will happen: a command, a path, or a URL. */
export function approvalDetail(a: ApprovalDTO): string | null {
  const d = a.detail as Record<string, unknown>;
  for (const key of ["command", "path", "url", "target"]) {
    const v = d[key];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

export function ApprovalNotice({
  approval,
  who,
  onDecide,
  clock,
  cat,
  still = false,
}: {
  approval: ApprovalDTO;
  who: string | null;
  /** the asking cat, drawn beside the request */
  cat?: AgentDTO | null;
  still?: boolean;
  onDecide: (a: ApprovalDTO, decision: "approve" | "deny", scope: "once" | "session") => Promise<void>;
  /** the run clock (the demo runs on the sample's own clock) */
  clock?: () => number;
}) {
  const act = useAction();
  const tick = useNow(15_000);
  const now = clock ? clock() : tick;
  const detail = approvalDetail(approval);
  const risk = RISK[approval.risk];
  const reason = typeof (approval.detail as Record<string, unknown>).reason === "string" ? String((approval.detail as Record<string, unknown>).reason) : null;
  const left = approval.expiresAt - now;
  const answer = (decision: "approve" | "deny", scope: "once" | "session") => act.run(() => onDecide(approval, decision, scope));

  return (
    <Notice
      tone="warning"
      title={who ? `${who} needs you` : "A cat needs you"}
      action={
        <>
          <button type="button" aria-busy={act.busy || undefined} onClick={() => answer("approve", "once")}>
            <ProductIcon name="check" size={20} />
            <span>Approve once</span>
          </button>
          <button type="button" className="btn-secondary" disabled={act.busy} onClick={() => answer("approve", "session")}>
            Allow for this session
          </button>
          <button type="button" className="btn-ghost" disabled={act.busy} onClick={() => answer("deny", "once")}>
            Deny
          </button>
        </>
      }
    >
      <div className="ask-body" data-cat={cat ? "" : undefined}>
        {cat ? (
          <span className="ask-cat">
            <Cat
              look={cat.look}
              role={cat.role}
              status={cat.status}
              activity={cat.activity}
              mood={cat.mood}
              label={`${cat.name}, ${ROLE_LABEL[cat.role]}, asking you`}
              size={64}
              still={still}
            />
          </span>
        ) : null}
        <div className="ask-text">
      <p className="approval-title">{approval.title}</p>
      {detail ? (
        <pre className="approval-code" tabIndex={0} aria-label="Exact request">
          <code>{detail}</code>
        </pre>
      ) : null}
      <p className="approval-meta">
        <span>{CAPABILITY[approval.capability]}</span>
        <span className="approval-risk">
          <ProductIcon name={risk.icon} size={16} />
          <span>{risk.word}</span>
        </span>
        {left > 0 ? (
          <span>
            Expires in <span className="num">{fmtDuration(left)}</span>
          </span>
        ) : (
          <span>Expired</span>
        )}
      </p>
      {reason ? <p className="approval-reason">Why: {reason}</p> : null}
        </div>
      </div>
      {act.error ? (
        <p className="app-form-status" data-tone="danger" role="alert">
          <ProductIcon name="alertCircle" size={16} />
          <span>{act.error}</span>
        </p>
      ) : null}
    </Notice>
  );
}

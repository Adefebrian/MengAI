// The run page hero: the living office from @mengai/cats. The scene is
// looked up on the package at runtime, so this page builds and runs while
// the cats package is still growing its Office: until it exports one, or if
// the scene throws, the desk view below stands in (every cat at its desk
// with its task, the file on its monitor, and the beat that is playing as
// a caption), fed by the very same props.
import * as Cats from "@mengai/cats";
import { CatCard, type OfficeBeat, type OfficeProps } from "@mengai/cats";
import { Component, useEffect, type CSSProperties, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import { roleWord } from "./office";

const Scene = Reflect.get(Cats, "Office") as ComponentType<OfficeProps> | undefined;

/** true once @mengai/cats exports the Office scene */
export const HAS_OFFICE_SCENE = typeof Scene === "function" || (typeof Scene === "object" && Scene !== null);

class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("office scene failed, showing the desk view", error, info.componentStack);
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function OfficeStage(props: OfficeProps) {
  const desks = <DeskView {...props} />;
  if (!HAS_OFFICE_SCENE || !Scene) return desks;
  return (
    <SceneBoundary fallback={desks}>
      <Scene {...props} />
    </SceneBoundary>
  );
}

function beatLine(b: OfficeBeat, name: (id: string) => string): string {
  switch (b.kind) {
    case "handoff":
      return `${name(b.fromId)} walks ${b.taskTitle} over to ${name(b.toId)}.`;
    case "ask":
      return `${name(b.fromId)} goes to ask ${name(b.toId)}: ${b.question}`;
    case "decided":
      return `${name(b.byId)} ${b.approved ? "approved" : "said no to"} ${name(b.toId)}: ${b.answer}`;
    case "review":
      return `${name(b.reviewerId)} brings the review to ${name(b.ownerId)}: ${b.passed ? "passed" : "changes needed"}.`;
    case "deliver":
      return `${name(b.fromId)} delivers ${b.taskTitle}.`;
    case "celebrate":
      return "The whole office celebrates.";
  }
}

/** Desks per row from 1024px, so every row of the floor is full or nearly so. */
function deskColumns(n: number): number {
  if (n <= 3) return Math.max(1, n);
  if (n === 4) return 2;
  if (n <= 6) return 3;
  return 4;
}

/** The stand-in scene: one desk per cat, the beat that plays as a caption. */
function DeskView({ agents, meetings, beats, onBeatDone, selectedId, onSelect, still, label }: OfficeProps) {
  const head = beats[0] ?? null;
  const name = (id: string) => agents.find((a) => a.id === id)?.name ?? "A cat";
  useEffect(() => {
    if (!head || !onBeatDone) return;
    const t = setTimeout(() => onBeatDone(head.id), still ? 900 : 2400);
    return () => clearTimeout(t);
  }, [head, onBeatDone, still]);
  const table = meetings.filter((m) => m.endedAt === null).at(-1) ?? null;
  return (
    <div className="desks" role="group" aria-label={label}>
      <p className="desks-note">The office floor plan is not in this build yet, so every cat is shown at its own desk.</p>
      <ul className="desks-grid" aria-label="Desks" style={{ "--desk-cols": String(deskColumns(agents.length)) } as CSSProperties}>
        {agents.map((a) => (
          <li key={a.id} className="desk" data-at-table={table?.agentIds.includes(a.id) ? "" : undefined}>
            <CatCard
              look={a.look}
              role={a.role}
              status={a.status}
              activity={a.activity}
              mood={a.mood}
              label={`${a.name}, ${roleWord(a.role)}`}
              size={64}
              still={still}
              name={a.name}
              statusText={a.statusText}
              taskTitle={a.taskTitle}
              energy={a.energy}
              selected={selectedId === a.id}
              onSelect={onSelect ? () => onSelect(a.id) : undefined}
            />
            <p className="desk-monitor">
              <span className="desk-monitor-label">On screen</span>
              <span className="desk-monitor-file" title={a.file ?? undefined}>
                {a.file ?? "Nothing open"}
              </span>
            </p>
          </li>
        ))}
      </ul>
      <p className="desks-beat" aria-live="polite">
        {head ? beatLine(head, name) : table ? `${table.title}: the crew is at the meeting table.` : "Everyone is at their desk."}
      </p>
    </div>
  );
}

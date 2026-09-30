// /tracker: the DeliveryTracker on a scripted run, for both company kinds.
// Each script walks every stage, and one check sends the work back once
// (the studio's review, the fund's risk review), so the courier turns
// round, drives back and wears the Round 2 tag until it passes that stop
// again; the last stop plays the arrival. The full tracker as the run page
// shows it, the compact one a side panel gets, and the still frames reduced
// motion gets. Composed from the JAL Core kit and AppShell. ?step=N opens
// at step N, ?paused=1 holds it there.
import { useEffect, useState } from "react";
import { AppShell, Page, Section, SectionHead } from "@mengai/ui";
import { COMPANY_STAGES, COMPANY_STAGE_LABEL, type CompanyKind } from "@mengai/shared";
import { DeliveryTracker, lookFor, type TrackerStage } from "../src/index";

export const TRACKER_TICK_MS = 2600;

interface Step {
  at: number;
  status: string;
  eta: string;
  looping?: boolean;
  loops?: number;
  done?: boolean;
  /** the reason the run entered this stage, shown when its stop is read */
  reason?: string;
}

const STUDIO: Step[] = [
  { at: 0, status: "Oyen got your goal: add a CSV export to the settings page.", eta: "Estimating", reason: "The goal landed on Oyen's desk." },
  { at: 1, status: "Oyen is dealing five task cards onto the plan board.", eta: "140k tokens to go", reason: "Oyen planned 5 tasks." },
  { at: 2, status: "Gembul and Klepon walked in with their boxes.", eta: "128k tokens to go", reason: "Gembul and Klepon joined the crew." },
  { at: 3, status: "Gembul is writing the serializer and Klepon wires the button.", eta: "104k tokens to go", reason: "Gembul started the serializer." },
  { at: 3, status: "Belang is writing tests for quoted commas, 2 of 5 tasks done.", eta: "88k tokens to go" },
  { at: 4, status: "Tempe is reading csv.ts line by line.", eta: "72k tokens to go", reason: "csv.ts went to review." },
  { at: 3, looping: true, loops: 1, status: "Tempe sent it back: doubled quotes and quoted newlines break the file.", eta: "64k tokens to go", reason: "The review asked for doubled quotes and quoted newlines." },
  { at: 3, looping: true, loops: 1, status: "Gembul is fixing the quotes for round 2.", eta: "52k tokens to go" },
  { at: 4, loops: 1, status: "The fix went back to Tempe.", eta: "40k tokens to go", reason: "The fix went back to Tempe." },
  { at: 5, loops: 1, status: "Review passed. Onde is testing the export on a real account.", eta: "22k tokens to go", reason: "Review passed, Onde tests the export." },
  { at: 6, loops: 1, done: true, status: "Delivered. Oyen signed the report and the crew is celebrating.", eta: "184k tokens used", reason: "Every check passed and Oyen signed the report." },
];

const FUND: Step[] = [
  { at: 0, status: "Oyen wrote the thesis: momentum in large caps after earnings.", eta: "Estimating", reason: "Oyen wrote the thesis." },
  { at: 1, status: "Jahe is pulling five years of daily prices.", eta: "120k tokens to go", reason: "Jahe started the data pull." },
  { at: 2, status: "Mochi is running the backtest on 2019 to 2024.", eta: "96k tokens to go", reason: "The backtest started." },
  { at: 3, status: "Duku is checking the drawdown against the limit.", eta: "80k tokens to go", reason: "The backtest went to the risk committee." },
  { at: 2, looping: true, loops: 1, status: "Duku sent it back: a 31% drawdown against a 15% limit.", eta: "72k tokens to go", reason: "Risk review asked for a stop loss." },
  { at: 2, looping: true, loops: 1, status: "Mochi adds a stop loss and runs the backtest again.", eta: "60k tokens to go" },
  { at: 3, loops: 1, status: "The new drawdown is 12%. Duku is signing off.", eta: "44k tokens to go", reason: "The fix went back to Duku." },
  { at: 4, loops: 1, status: "Paper trading on the practice account.", eta: "30k tokens to go", reason: "Risk passed, paper trades start." },
  { at: 5, loops: 1, status: "Two sample orders wait for your approval.", eta: "16k tokens to go", reason: "Paper results held, live trades proposed." },
  { at: 6, loops: 1, done: true, status: "Delivered. Oyen wrote the P&L report.", eta: "171k tokens used", reason: "The P&L report is ready." },
];

const SCRIPTS: Record<CompanyKind, Step[]> = { studio: STUDIO, fund: FUND };
/** The last step holds this many ticks before the run starts over. */
const HOLD = 2;

/** The stages at one step: each stop reads the reason the run last entered it. */
export function stagesAt(kind: CompanyKind, index: number): TrackerStage[] {
  const steps = SCRIPTS[kind];
  const detail: Record<number, string> = {};
  for (let i = 0; i <= Math.min(index, steps.length - 1); i++) {
    const s = steps[i]!;
    if (s.reason) detail[s.at] = s.reason;
  }
  return COMPANY_STAGES[kind].map((id, i) => ({ id, label: COMPANY_STAGE_LABEL[id] ?? id, detail: detail[i] ?? null }));
}

/** ?step=N opens every script at step N (1-based), for captures. */
function startTick(): number {
  const n = Number(new URLSearchParams(location.search).get("step") ?? "1");
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) - 1 : 0;
}

function useScript(kind: CompanyKind, playing: boolean) {
  const steps = SCRIPTS[kind];
  const [state, setState] = useState(() => ({ tick: Math.min(startTick(), steps.length - 1), round: 0 }));
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setState((s) => (s.tick + 1 >= steps.length + HOLD ? { tick: 0, round: s.round + 1 } : { ...s, tick: s.tick + 1 }));
    }, TRACKER_TICK_MS);
    return () => clearInterval(timer);
  }, [playing, steps.length]);
  const index = Math.min(state.tick, steps.length - 1);
  return {
    index,
    step: steps[index]!,
    total: steps.length,
    round: state.round,
    restart: () => setState((s) => ({ tick: 0, round: s.round + 1 })),
  };
}

const OYEN = { name: "Oyen", look: lookFor("Oyen") };

function ScriptTracker({ kind, index, compact, still, round }: { kind: CompanyKind; index: number; compact?: boolean; still?: boolean; round: number }) {
  const step = SCRIPTS[kind][index]!;
  return (
    <DeliveryTracker
      key={round}
      stages={stagesAt(kind, index)}
      current={step.at}
      looping={step.looping}
      loops={step.loops ?? 0}
      done={Boolean(step.done)}
      status={step.status}
      eta={step.eta}
      courier={OYEN}
      compact={compact}
      still={still}
    />
  );
}

const destinations = [
  { id: "studio", label: "Studio", href: "#studio" },
  { id: "fund", label: "Fund", href: "#fund" },
  { id: "compact", label: "Compact", href: "#compact" },
  { id: "still", label: "Still", href: "#still" },
];

export function TrackerPreview({ reduced }: { reduced: boolean }) {
  const [playing, setPlaying] = useState(!reduced && new URLSearchParams(location.search).get("paused") !== "1");
  const studio = useScript("studio", playing);
  const fund = useScript("fund", playing);
  return (
    <Page rhythm="default" motion="none">
      <AppShell title="MengAI tracker" destinations={destinations} current="studio" archetype={{ bar: "bar", labels: "all" }}>
        <Section id="studio" tone="base" labelledBy="studio-title" composition="custom" variant="tracker-live">
          <div className="kit-head pv-office-head" data-layout="split">
            <h1 id="studio-title" className="kit-heading">
              Track a run like a delivery
            </h1>
            <p className="kit-lead">Oyen rides the route from the goal to shipped. Tap a stop to read what happened there. A sample run on a loop, where the review sends the work back once.</p>
            <div className="kit-head-action pv-office-controls">
              <button type="button" className="btn btn-secondary" aria-pressed={!playing} onClick={() => setPlaying((p) => !p)}>
                {playing ? "Pause the run" : "Play the run"}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  studio.restart();
                  fund.restart();
                }}
              >
                Restart
              </button>
            </div>
          </div>
          <p className="kit-meta pv-num pv-office-time kit-full" aria-live="polite">
            Step {studio.index + 1} of {studio.total}
          </p>
          <div className="kit-full pv-tracker">
            <ScriptTracker kind="studio" index={studio.index} round={studio.round} />
          </div>
        </Section>
        <Section id="fund" tone="layer" labelledBy="fund-title" composition="custom" variant="tracker-fund">
          <SectionHead id="fund-title" title="A hedge fund run" lead="The same courier on the fund's stages. The risk review sends the backtest back once, over a drawdown past its limit." />
          <div className="kit-full pv-tracker">
            <ScriptTracker kind="fund" index={fund.index} round={fund.round} />
          </div>
        </Section>
        <Section id="compact" tone="base" labelledBy="compact-title" composition="custom" variant="tracker-compact">
          <SectionHead id="compact-title" title="In a side panel" lead="The compact tracker keeps the strip over two lines at any width, for a panel or a phone." />
          <div className="kit-full pv-tracker-pair">
            <figure className="pv-figure pv-tracker-panel">
              <ScriptTracker kind="studio" index={studio.index} round={studio.round} compact />
              <figcaption className="kit-meta">Studio</figcaption>
            </figure>
            <figure className="pv-figure pv-tracker-panel">
              <ScriptTracker kind="fund" index={fund.index} round={fund.round} compact />
              <figcaption className="kit-meta">Hedge fund</figcaption>
            </figure>
          </div>
        </Section>
        <Section id="still" tone="layer" labelledBy="still-title" composition="custom" variant="tracker-still">
          <SectionHead id="still-title" title="Still, for reduced motion" lead="The courier waits at its stop, moves are instant, and the ticks, the round and the names say the rest." />
          <div className="kit-full pv-tracker-stack">
            <ScriptTracker kind="studio" index={7} round={0} still />
            <ScriptTracker kind="fund" index={FUND.length - 1} round={0} still />
          </div>
        </Section>
      </AppShell>
    </Page>
  );
}

// The run screen, the core of MengAI: the crew of cats at work on one goal.
// Structure (structure roll "MengAI" "/app/runs/:id", key 5525723a, drawn
// c3 ethogram swimlanes; JEV ui.region_gate kept every region): the run
// header with the note to the lead, the request that blocks a cat (rises in
// when it arrives, drops out when answered), the run report with its replay
// once the run ends, the floor (one lane per cat, task cards travelling
// across status columns and between lanes), then the record tabs:
// timeline, decisions, usage, the prompt X-ray and files. A cat opens in a
// drawer (a bottom sheet below 640px), a task in a sheet.
import type { ProjectDTO } from "@mengai/shared";
import { Drawer, EmptyState, ProductIcon, SkeletonRows, TabPanel, Tabs } from "@mengai/ui/src/product";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Link, navigate, useLocation } from "../../router";
import { useApp } from "../context";
import { useMedia, useNow } from "../hooks";
import { T, useMotionLevel } from "../motion";
import { isFinished } from "../status";
import { Page } from "../ui";
import { ApprovalNotice } from "../parts/ApprovalNotice";
import { AgentDetail } from "./AgentDetail";
import { Decisions } from "./Decisions";
import { runApprovals, spendByAgent } from "./derive";
import { Files } from "./Files";
import { Floor } from "./Floor";
import { MessageBox } from "./MessageBox";
import { Replay } from "./Replay";
import { RunHeader } from "./RunHeader";
import { TaskSheet } from "./TaskSheet";
import { Timeline } from "./Timeline";
import { Usage } from "./Usage";
import { stateAt, useRunData } from "./useRunData";
import { Xray } from "./Xray";

type TabId = "timeline" | "decisions" | "usage" | "xray" | "files";

export function RunScreen({ runId }: { runId: string }) {
  const { api, catsStill, refreshApprovals } = useApp();
  const data = useRunData(runId);
  const wide = useMedia("(min-width: 640px)");
  const level = useMotionLevel();
  const [selected, setSelected] = useState<string | null>(null);
  const location = useLocation();
  const openTask = new URLSearchParams(location.hash.replace(/^#/, "")).get("task");
  const closeTask = () => navigate(location.pathname + location.search, { replace: true });
  const [tab, setTab] = useState<TabId>("timeline");
  const [xrayAgent, setXrayAgent] = useState<string | null>(null);
  const [replayAt, setReplayAt] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [project, setProject] = useState<ProjectDTO | null>(null);
  const live = data.state;
  const finished = !!live.run && isFinished(live.run.status);
  const tick = useNow(1000, !!live.run && !finished);

  const projectId = live.run?.projectId ?? null;
  useEffect(() => {
    if (!projectId) return;
    const ctrl = new AbortController();
    api.call("GET /api/projects/:id", { params: { id: projectId }, signal: ctrl.signal }).then(setProject, () => setProject(null));
    return () => ctrl.abort();
  }, [api, projectId]);

  const replaying = replayAt !== null && !!data.replayLog;
  const shown = useMemo(() => {
    if (!replaying || !data.replayLog) return live;
    return { ...stateAt(data.replayLog, replayAt!, runId), connection: live.connection };
  }, [replaying, data.replayLog, replayAt, runId, live]);

  const spend = useMemo(() => spendByAgent(data.calls.filter((c) => !replaying || c.createdAt <= (shown.log.at(-1)?.ts ?? 0))), [data.calls, replaying, shown]);
  const now = replaying ? (shown.log.at(-1)?.ts ?? 0) : finished ? (live.run?.endedAt ?? tick) : data.now();
  void tick;

  if (data.loading && !live.run) {
    return (
      <Page>
        <SkeletonRows rows={5} label="Waking the crew" />
      </Page>
    );
  }
  if (data.error && !live.run) {
    return (
      <Page>
        <h1 className="app-title">This run did not load</h1>
        <EmptyState
          icon="alertCircle"
          tone="danger"
          title="The run could not be read"
          action={
            <>
              <button type="button" onClick={data.reload}>
                <ProductIcon name="refresh" size={20} />
                <span>Try again</span>
              </button>
              <Link className="btn btn-secondary" href="/app">
                Back to runs
              </Link>
            </>
          }
        >
          {data.error}
        </EmptyState>
      </Page>
    );
  }
  if (!live.run) {
    return (
      <Page>
        <SkeletonRows rows={5} label="Waking the crew" />
      </Page>
    );
  }

  const approvals = replaying ? [] : runApprovals(live);
  const lead = shown.agentOrder.map((id) => shown.agents[id]).find((a) => a?.role === "lead");
  const leadName = lead?.name ?? "Kopi";
  const selectedAgent = selected && shown.agents[selected] ? selected : null;

  const openXray = (agentId: string) => {
    setXrayAgent(agentId);
    setTab("xray");
    setSelected(null);
    requestAnimationFrame(() => document.getElementById("run-tabs")?.scrollIntoView({ block: "start", behavior: level === "off" ? "auto" : "smooth" }));
  };

  const detail = selectedAgent ? (
    <AgentDetail
      state={shown}
      agentId={selectedAgent}
      spend={spend}
      now={now}
      still={catsStill}
      onXray={openXray}
      onStop={data.stopAgent}
      replaying={replaying}
    />
  ) : null;

  const tabs: Array<{ id: TabId; label: string; count?: number }> = [
    { id: "timeline", label: "Timeline" },
    { id: "decisions", label: "Decisions", count: shown.decisions.length },
    { id: "usage", label: "Usage" },
    { id: "xray", label: "X-ray" },
    { id: "files", label: "Files", count: Object.keys(shown.files).length || undefined },
  ];
  const off = level === "off";

  return (
    <Page>
      <RunHeader state={shown} project={project} replaying={replaying} onPause={data.pause} onResume={data.resume} onStop={data.stop} />

      {!finished && !replaying ? <MessageBox lead={leadName} onSend={data.message} /> : null}

      <AnimatePresence initial={false}>
        {approvals.length > 0 ? (
          <motion.section
            key="ask"
            className="app-region approvals-now"
            data-container="card"
            aria-label="Waiting on you"
            initial={off ? { opacity: 0 } : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0, transition: off ? T.reduced : T.slow }}
            exit={{ opacity: 0, y: off ? 0 : 8, transition: off ? T.reduced : T.slowExit }}
          >
            {approvals.map((a) => (
              <ApprovalNotice
                key={a!.id}
                approval={a!}
                who={a!.agentId ? (live.agents[a!.agentId]?.name ?? null) : null}
                cat={a!.agentId ? (live.agents[a!.agentId] ?? null) : null}
                still={catsStill}
                clock={data.isDemo ? data.now : undefined}
                onDecide={async (ap, d, scope) => {
                  await data.decide(ap, d, scope);
                  refreshApprovals();
                }}
              />
            ))}
          </motion.section>
        ) : null}
      </AnimatePresence>

      {finished ? (
        <Replay
          state={live}
          log={data.replayLog}
          at={replayAt}
          playing={playing}
          onSeek={setReplayAt}
          onPlay={setPlaying}
          onExit={() => {
            setPlaying(false);
            setReplayAt(null);
          }}
        />
      ) : null}

      <Floor
        state={shown}
        spend={spend}
        selected={selectedAgent}
        onSelect={(id) => setSelected((cur) => (cur === id ? null : id))}
        still={catsStill}
        catSize={wide ? 96 : 64}
        motion={level}
      />

      <div className="run-tabs" id="run-tabs">
        <Tabs label="Run records" idPrefix="run" items={tabs} selected={tab} onSelect={(id) => setTab(id as TabId)} />
        {tabs.map((t) => (
          <TabPanel key={t.id} idPrefix="run" id={t.id} selected={tab === t.id}>
            {t.id === "timeline" ? <Timeline state={shown} /> : null}
            {t.id === "decisions" ? <Decisions decisions={shown.decisions} /> : null}
            {t.id === "usage" ? <Usage state={shown} calls={data.calls} /> : null}
            {t.id === "xray" ? <Xray state={shown} runId={runId} agentId={xrayAgent} onAgent={setXrayAgent} /> : null}
            {t.id === "files" ? <Files state={shown} projectId={projectId} projectName={project?.name ?? null} /> : null}
          </TabPanel>
        ))}
      </div>

      <Drawer
        open={!!selectedAgent}
        onClose={() => setSelected(null)}
        title={selectedAgent ? (shown.agents[selectedAgent]?.name ?? "Cat") : "Cat"}
        description="What this cat is doing right now"
      >
        {detail}
      </Drawer>

      <TaskSheet
        state={shown}
        taskId={openTask && shown.tasks[openTask] ? openTask : null}
        onClose={closeTask}
        onPatch={data.patchTask}
        readOnly={replaying || finished}
      />
    </Page>
  );
}

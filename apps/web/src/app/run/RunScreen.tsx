// The run page, the core of MengAI: the cat company at work on one goal.
// Structure (JEV ui.region_gate, every region kept; containers in the
// comments of each part): the run header, the request that blocks a cat
// (rises in when it arrives, drops out when answered), the live status
// strip in cat voice, then the living office as the hero (every cat at its
// own desk, walking to a colleague for a handoff, to the CEO to ask, to the
// meeting table, the plan on the CEO whiteboard). Once the run ends the
// report and its scrubber sit right under the office and drive it again.
// From 1024px the office spans the page (JEV ui.stage_layout full_office
// 0.88: at full width the scene puts the CEO room and the meeting room side
// by side over the pods, so the whole floor fits one screen); under it the
// code editor sits beside a side stack of the meetings and CEO calls over
// the task queue, and the records are tabs below. Below 1024px the office is
// on top and every panel is a tab. A cat opens in a drawer (a bottom sheet
// below 640px), a task in a sheet.
import type { OfficeProps } from "@mengai/cats";
import type { ProjectDTO } from "@mengai/shared";
import { Drawer, EmptyState, ProductIcon, SkeletonRows, TabPanel, Tabs } from "@mengai/ui/src/product";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Link, navigate, useLocation } from "../../router";
import { useApp } from "../context";
import { DESKTOP_QUERY, useMedia, useNow } from "../hooks";
import { T, useMotionLevel } from "../motion";
import { isFinished } from "../status";
import { Page } from "../ui";
import { ApprovalNotice } from "../parts/ApprovalNotice";
import { AgentDetail } from "./AgentDetail";
import { CodeEditor } from "./CodeEditor";
import { CompanyFeed } from "./CompanyFeed";
import { Decisions } from "./Decisions";
import { runApprovals, spendByAgent } from "./derive";
import { leadOf, officeAgents, officeLabel, officeMeetings, officePlan } from "./office";
import { OfficeStage } from "./OfficeStage";
import { Replay } from "./Replay";
import { RunHeader } from "./RunHeader";
import { StatusStrip } from "./StatusStrip";
import { TaskQueue, queueGroups } from "./TaskQueue";
import { TaskSheet } from "./TaskSheet";
import { Timeline } from "./Timeline";
import { Usage } from "./Usage";
import { useOfficeBeats } from "./useOfficeBeats";
import { stateAt, useRunData } from "./useRunData";
import { Xray } from "./Xray";

type TabId = "feed" | "code" | "tasks" | "timeline" | "usage" | "xray" | "decisions";

export function RunScreen({ runId }: { runId: string }) {
  const { api, catsStill, refreshApprovals } = useApp();
  const data = useRunData(runId);
  const desktop = useMedia(DESKTOP_QUERY);
  const level = useMotionLevel();
  const [selected, setSelected] = useState<string | null>(null);
  const location = useLocation();
  const openTask = new URLSearchParams(location.hash.replace(/^#/, "")).get("task");
  const closeTask = () => navigate(location.pathname + location.search, { replace: true });
  const [tab, setTab] = useState<TabId | null>(null);
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
  // A finished run opens from its snapshot, which carries no event log; once
  // the whole log is in, the page reads the run folded from it, so the
  // timeline, the feed, the files and the report are complete.
  const full = useMemo(
    () => (finished && data.replayLog && data.replayLog.length > 0 ? stateAt(data.replayLog, data.replayLog.length, runId) : null),
    [finished, data.replayLog, runId],
  );
  const shown = useMemo(() => {
    if (replaying && data.replayLog) {
      const r = stateAt(data.replayLog, replayAt!, runId);
      // Before the log's first event the run is not created yet: show it as queued.
      const run = r.run ?? (live.run ? { ...live.run, status: "queued" as const, statusReason: null, progress: 0, startedAt: null, endedAt: null, usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, costUsd: 0, calls: 0 } } : null);
      return { ...r, run, connection: live.connection };
    }
    if (full && full.run) return { ...full, run: live.run ?? full.run, connection: live.connection };
    return live;
  }, [replaying, data.replayLog, replayAt, runId, live, full]);

  const spend = useMemo(() => spendByAgent(data.calls.filter((c) => !replaying || c.createdAt <= (shown.log.at(-1)?.ts ?? 0))), [data.calls, replaying, shown]);
  const now = replaying ? (shown.log.at(-1)?.ts ?? 0) : finished ? (live.run?.endedAt ?? tick) : data.now();
  void tick;

  const { beats, done } = useOfficeBeats(shown);
  const selectedAgent = selected && shown.agents[selected] ? selected : null;
  const officeProps = useMemo<OfficeProps>(
    () => ({
      agents: officeAgents(shown, spend),
      meetings: officeMeetings(shown),
      beats,
      onBeatDone: done,
      plan: officePlan(shown),
      selectedId: selectedAgent,
      onSelect: (id: string) => setSelected((cur) => (cur === id ? null : id)),
      variant: "full",
      still: catsStill,
      label: officeLabel(shown),
    }),
    [shown, spend, beats, done, selectedAgent, catsStill],
  );

  if (data.loading && !live.run) {
    return (
      <Page>
        <SkeletonRows rows={5} label="Opening the office" />
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
        <SkeletonRows rows={5} label="Opening the office" />
      </Page>
    );
  }

  const approvals = replaying ? [] : runApprovals(live);
  const off = level === "off";

  const openXray = (agentId: string) => {
    setXrayAgent(agentId);
    setTab("xray");
    setSelected(null);
    requestAnimationFrame(() => document.getElementById("run-tabs")?.scrollIntoView({ block: "start", behavior: off ? "auto" : "smooth" }));
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

  const groups = queueGroups(shown);
  const meetings = shown.meetingOrder.length + shown.requestOrder.length;
  const tabs: Array<{ id: TabId; label: string; count?: number }> = [
    ...(desktop
      ? []
      : ([
          { id: "feed", label: "Meetings", count: meetings || undefined },
          { id: "code", label: "Code" },
          { id: "tasks", label: "Tasks", count: groups.doing.length + groups.review.length || undefined },
        ] as Array<{ id: TabId; label: string; count?: number }>)),
    { id: "timeline", label: "Timeline" },
    { id: "usage", label: "Usage" },
    { id: "xray", label: "X-ray" },
    { id: "decisions", label: "JEV calls", count: shown.decisions.length || undefined },
  ];
  const current: TabId = tab && tabs.some((t) => t.id === tab) ? tab : tabs[0]!.id;

  const feed = <CompanyFeed state={shown} replaying={replaying} onSend={data.message} />;
  const code = <CodeEditor state={shown} projectId={projectId} projectName={project?.name ?? null} still={catsStill} />;
  const queue = <TaskQueue state={shown} />;
  const replay = finished ? (
    <Replay
      state={full ?? live}
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
  ) : null;

  const office = (
    <section className="app-region run-office" data-container="plain" aria-labelledby="office-h">
      <div className="p-sr-wrap">
        <h2 className="p-sr-only" id="office-h">
          The office of {leadOf(shown)?.name ?? "the CEO"}'s crew
        </h2>
      </div>
      <OfficeStage {...officeProps} />
    </section>
  );

  return (
    <Page>
      <RunHeader state={shown} project={project} replaying={replaying} onPause={data.pause} onResume={data.resume} onStop={data.stop} />

      <AnimatePresence initial={false}>
        {approvals.length > 0 ? (
          <motion.section
            key="ask"
            className="app-region approvals-now"
            data-container="divided"
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

      <StatusStrip state={shown} />

      {desktop ? (
        <>
          {office}
          {replay}
          <div className="run-work">
            {code}
            <div className="run-side">
              {feed}
              {queue}
            </div>
          </div>
        </>
      ) : (
        <>
          {office}
          {replay}
        </>
      )}

      <div className="run-tabs" id="run-tabs">
        <Tabs label="Run panels" idPrefix="run" items={tabs} selected={current} onSelect={(id) => setTab(id as TabId)} />
        {tabs.map((t) => (
          <TabPanel key={t.id} idPrefix="run" id={t.id} selected={current === t.id}>
            {t.id === "feed" ? feed : null}
            {t.id === "code" ? code : null}
            {t.id === "tasks" ? queue : null}
            {t.id === "timeline" ? <Timeline state={shown} /> : null}
            {t.id === "usage" ? <Usage state={shown} calls={data.calls} /> : null}
            {t.id === "xray" ? <Xray state={shown} runId={runId} agentId={xrayAgent} onAgent={setXrayAgent} /> : null}
            {t.id === "decisions" ? <Decisions decisions={shown.decisions} /> : null}
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

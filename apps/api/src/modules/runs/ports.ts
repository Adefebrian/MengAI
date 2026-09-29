// What the runs module needs from the rest of the monolith. Every entry is a
// service interface from core/services.ts (or a port), injected by
// core/container.ts. The orchestrator never imports another module.
import type { ApprovalDTO, MengaiEvent } from "@mengai/shared";
import type {
  AutomationService,
  ContextService,
  DecisionService,
  KillSwitch,
  MemoryService,
  ProjectsService,
  SettingsService,
  ToolsService,
  UsageService,
  WorkspaceService,
} from "../../core/services";
import type { LlmRouter } from "../../core/ports";

export interface RunsDeps {
  projects: ProjectsService;
  llm: LlmRouter & CompanyPace;
  usage: UsageService;
  context: ContextService;
  memory: MemoryService & MemoryPromotion;
  tools: ToolsService;
  decisions: DecisionService;
  settings: SettingsService;
  killswitch: KillSwitch;
  automation: AutomationService;
  /** workspace digest for the run brief (not in the W1 table; see the runs report) */
  workspace: WorkspaceService;
  /** pending approvals for the run snapshot; the automation interface has no list call yet */
  approvals?: { list(runId: string): Promise<ApprovalDTO[]> };
  /**
   * Optional read side of the event log (the events module's EventBus.after).
   * When wired, the snapshot of a run that is not live in this process
   * rebuilds its meetings from meeting.started / meeting.ended.
   */
  eventLog?: { after(seq: number, runId: string | null, limit: number): Promise<MengaiEvent[]> };
}

/**
 * Optional pace hint a router may carry. The scripted demo crew holds
 * meetings for 6 to 10 s so every beat is watchable; tests use a few ms.
 * Without it a meeting is held for COMPANY.meetingMs.
 */
export interface CompanyPace {
  company?: { meetingMs?: readonly [number, number] };
}

/** Optional memory extension: promote lessons that earned it after a run. */
export interface MemoryPromotion {
  promoteEligible?(input: { projectId: string; runId: string }): Promise<unknown>;
}

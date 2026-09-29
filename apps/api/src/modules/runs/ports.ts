// What the runs module needs from the rest of the monolith. Every entry is a
// service interface from core/services.ts (or a port), injected by
// core/container.ts. The orchestrator never imports another module.
import type { ApprovalDTO } from "@mengai/shared";
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
  llm: LlmRouter;
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
}

/** Optional memory extension: promote lessons that earned it after a run. */
export interface MemoryPromotion {
  promoteEligible?(input: { projectId: string; runId: string }): Promise<unknown>;
}

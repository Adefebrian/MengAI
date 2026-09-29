// Which run changed a file. The tools module wraps each tool execution in
// runWithFileOrigin(), so every file.changed event published while that call
// runs (including writes made by services it calls) carries the run, agent
// and task ids without widening the WorkspaceService interface.
import { AsyncLocalStorage } from "node:async_hooks";

export interface FileOrigin {
  runId: string | null;
  agentId?: string | null;
  taskId?: string | null;
}

const store = new AsyncLocalStorage<FileOrigin>();

export function runWithFileOrigin<T>(origin: FileOrigin, fn: () => Promise<T>): Promise<T> {
  return store.run(origin, fn);
}

export function currentFileOrigin(): FileOrigin | null {
  return store.getStore() ?? null;
}

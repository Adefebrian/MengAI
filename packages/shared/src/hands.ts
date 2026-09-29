// Contract for services/hands, the Rust helper that performs local macOS
// automation. Bun owns this contract; the helper implements it.
//
// Transport: JSON-RPC 2.0, one JSON object per line (NDJSON) over the
// helper's stdin (requests) and stdout (responses). stderr is logs only.
// The helper never opens a socket, never persists, and exits when stdin
// closes. Coordinates are in global display points (top-left origin).

export interface HandsRequest<M extends HandsMethod = HandsMethod> {
  jsonrpc: "2.0";
  id: number;
  method: M;
  params: HandsParams[M];
}

export interface HandsSuccess<M extends HandsMethod = HandsMethod> {
  jsonrpc: "2.0";
  id: number;
  result: HandsResults[M];
}

export interface HandsFailure {
  jsonrpc: "2.0";
  id: number | null;
  error: { code: number; message: string; data?: unknown };
}

export type HandsResponse<M extends HandsMethod = HandsMethod> = HandsSuccess<M> | HandsFailure;

export interface AxNode {
  role: string;
  title?: string;
  value?: string;
  description?: string;
  /** frame in global points */
  frame?: { x: number; y: number; w: number; h: number };
  enabled?: boolean;
  focused?: boolean;
  /** true for AXSecureTextField: values are never returned and input is refused */
  secure?: boolean;
  children?: AxNode[];
}

export interface HandsParams {
  status: Record<string, never>;
  "permissions.check": Record<string, never>;
  "permissions.request": { kind: "accessibility" | "screen" };
  "screen.capture": { display?: number; maxWidth?: number; region?: { x: number; y: number; w: number; h: number } };
  "ax.tree": { bundleId?: string; pid?: number; depth?: number; maxNodes?: number };
  "ax.focused": Record<string, never>;
  "input.move": { x: number; y: number };
  "input.click": { x: number; y: number; button?: "left" | "right"; count?: 1 | 2 };
  "input.scroll": { dx: number; dy: number };
  "input.type": { text: string };
  /** combo like "cmd+s", "enter", "shift+tab" */
  "input.key": { combo: string };
  "app.open": { bundleId?: string; name?: string };
  "app.activate": { bundleId: string };
  "app.list": Record<string, never>;
  /** releases held keys and buttons, cancels queued input; always succeeds */
  stop: Record<string, never>;
}

export interface HandsResults {
  status: { version: string; pid: number; platform: string };
  "permissions.check": { accessibility: boolean; screen: boolean };
  "permissions.request": { prompted: boolean; granted: boolean };
  "screen.capture": { pngBase64: string; width: number; height: number; scale: number };
  "ax.tree": { root: AxNode; truncated: boolean };
  "ax.focused": { app: string | null; node: AxNode | null };
  "input.move": { ok: true };
  "input.click": { ok: true };
  "input.scroll": { ok: true };
  "input.type": { ok: true; chars: number };
  "input.key": { ok: true };
  "app.open": { ok: true; bundleId: string | null };
  "app.activate": { ok: true };
  "app.list": { apps: Array<{ name: string; bundleId: string | null; pid: number; active: boolean }> };
  stop: { ok: true };
}

export type HandsMethod = keyof HandsParams;

export const HANDS_METHODS = [
  "status",
  "permissions.check",
  "permissions.request",
  "screen.capture",
  "ax.tree",
  "ax.focused",
  "input.move",
  "input.click",
  "input.scroll",
  "input.type",
  "input.key",
  "app.open",
  "app.activate",
  "app.list",
  "stop",
] as const satisfies readonly HandsMethod[];

/** JSON-RPC error codes used by the helper. */
export const HANDS_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  /** a TCC permission is missing */
  permissionDenied: -32001,
  /** secure event input is active (password field focused), input refused */
  secureInput: -32002,
  /** the helper is stopping (kill switch) */
  stopped: -32003,
} as const;

// Process execution port for agent shell commands. The local adapter jails
// every command with a Seatbelt profile (writes only inside writablePaths,
// no reads of ~/.ssh, keychains or the app data dir, network only when
// allowed), a scrubbed env, a process group, hard timeouts and output caps.
export interface ExecRequest {
  command: string;
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
  /** extra env on top of the scrubbed base env (PATH, HOME=cwd, LANG, TERM) */
  env?: Record<string, string>;
  network: boolean;
  writablePaths: string[];
  /** local engine ports the command may never connect to, network on or off (the Seatbelt runner denies them; lib/engine-guard.ts) */
  denyTcpPorts?: number[];
  signal?: AbortSignal;
}

export interface ExecResult {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
  killed: boolean;
  durationMs: number;
}

export interface Runner {
  exec(req: ExecRequest): Promise<ExecResult>;
  /** Kill every live process group this runner started. Returns how many. */
  killAll(): Promise<number>;
  running(): number;
}

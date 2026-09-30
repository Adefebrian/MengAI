// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Windows runner: refuses every agent command. Windows has no crew sandbox
// yet (nothing like the macOS Seatbelt profile that keeps a command off the
// engine port), so a command could drive the no-auth local API. It fails
// closed with the "Coming soon on Windows" reason and never looks for
// /bin/sh or any other shell. The tools module also drops shell_run from
// every role on this platform (lib/platform.ts), so this is the last line.
import { comingSoonText } from "../../lib/platform";
import type { ExecRequest, ExecResult, Runner } from "../ports/runner";
import { RunnerError } from "./runner-plain";

export function createWindowsRunner(opts: { platform?: string } = {}): Runner {
  const reason = comingSoonText(opts.platform ?? "win32", "shell");
  return {
    async exec(_req: ExecRequest): Promise<ExecResult> {
      throw new RunnerError("sandbox_unavailable", reason);
    },
    async killAll() {
      return 0;
    },
    running: () => 0,
  };
}

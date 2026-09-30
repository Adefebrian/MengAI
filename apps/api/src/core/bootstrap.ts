// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Boot entry used by the server entrypoint, the local sidecar and tests.
// Everything is wired by core/container.ts; this file keeps the stable names
// (bootstrap, BootstrapOptions, Platform) the entrypoints and tests import.
import { createContainer, type Container, type ContainerOptions } from "./container";

export type BootstrapOptions = ContainerOptions;

/** The running app: every module mounted, the kill switch, the ports in ctx. */
export type Platform = Container;

export function bootstrap(opts: BootstrapOptions): Promise<Platform> {
  return createContainer(opts);
}

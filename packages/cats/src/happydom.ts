// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Preloaded before every test in packages/cats (see bunfig.toml). Bun has no
// built-in DOM, this registers happy-dom globally so the cat renders under
// `bun test`.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

// happy-dom 20 implements the Web Animations API on a clock these suites do
// not drive. The product feature-detects element.animate, and the tests were
// written for the path without it, so that path stays under test.
for (const proto of [Element.prototype, Document.prototype] as unknown as Array<Record<string, unknown>>) {
  delete proto.animate;
  delete proto.getAnimations;
}

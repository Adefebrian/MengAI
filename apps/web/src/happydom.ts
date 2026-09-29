// Preloaded before every test in apps/web (see bunfig.toml). Bun has no
// built-in DOM, this registers happy-dom globally so React components can
// render under `bun test`.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

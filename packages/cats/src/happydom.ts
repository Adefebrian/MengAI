// Preloaded before every test in packages/cats (see bunfig.toml). Bun has no
// built-in DOM, this registers happy-dom globally so the cat renders under
// `bun test`.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

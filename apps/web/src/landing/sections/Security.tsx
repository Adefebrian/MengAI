// Privacy and security (kit.bento.lead-right; critic fix round 2: the six
// icon cells became the app's own controls on labelled sample data). JEV
// ui.region_gate sec_views kept (relevance 1.82, bento 0.58);
// motion.intensity 1.61, tier 2; motion.choreography reveal (0.88);
// ui.component_recipe kit.bento_reveal_states (0.48, low, the top pick
// kept): the tiles arrive in one batch and each view carries its own state
// change. The permission ask and the kill switch lead; the budget meter,
// the keychain and the project jail sit around them. Every line restates
// docs/architecture.md, nothing more.
import type { JSX } from "react";
import { BentoGrid, BentoTile } from "@mengai/ui";
import { AskView, AuditView, BudgetView, JailView, KillView, VaultView } from "../views/security";

export interface Safeguard {
  area: string;
  title: string;
  body: string;
}

// kit BENTO_PRESETS[4]["lead-right"]: a b c c / d d c c. The lead (c) holds
// the two controls you act on, the ask and the kill switch; the budget and
// the keychain sit beside it, the project jail under them.
export const SAFEGUARDS: Safeguard[] = [
  {
    area: "a",
    title: "A budget on every run",
    body: "Each run stops at 400,000 tokens unless you change it, and guards end loops that stop making progress.",
  },
  {
    area: "b",
    title: "Keys stay in the vault",
    body: "Kept in the macOS Keychain on your own machine, never on this website, and scrubbed from every output before a cat sees it.",
  },
  {
    area: "c",
    title: "A cat asks, and you can stop it all",
    body: "Installs, deletes and anything that sends data out wait for your answer, with the exact command shown. The kill switch ends every call and command at once, and every answer lands in the audit log.",
  },
  {
    area: "d",
    title: "Jailed to your project",
    body: "Files and commands stay inside the project folder unless you grant more, and the Mac app answers only on 127.0.0.1.",
  },
];

function Controls() {
  return (
    <div className="lp-sec-stack">
      <AskView />
      <KillView />
      <AuditView />
    </div>
  );
}

const VIEWS: Record<string, () => JSX.Element> = { a: BudgetView, b: VaultView, c: Controls, d: JailView };

export function SecuritySection() {
  return (
    <BentoGrid
      id="security"
      tone="layer"
      preset="lead-right"
      title="Your code, your keys, your budget"
      lead="The crew works for you inside limits you can see and change. These are the app's own controls on sample data: try them."
    >
      {SAFEGUARDS.map((s) => {
        const View = VIEWS[s.area]!;
        return (
          <BentoTile
            key={s.area}
            area={s.area}
            kind="media"
            media={
              <div className="lp-tile-view lp-sec-tile">
                <View />
              </div>
            }
            title={s.title}
            body={s.body}
          />
        );
      })}
    </BentoGrid>
  );
}

// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// JEV decisions (JEV: card, ui.component_recipe core.list.meter): a summary
// line, then one row per decision with the catalog id in mono, the action
// the engine took, the confidence as a tabular percent beside a short
// meter, and whether JEV verified it (icon plus word, never color alone).
import type { DecisionDTO } from "@mengai/shared";
import { ProductIcon } from "@mengai/ui/src/product";
import { AnimatePresence, motion } from "motion/react";
import { fmtClock, fmtPct } from "../format";
import { RegionHead } from "../ui";

const ease = [0.24, 1, 0.4, 1] as const;

export function Decisions({ decisions }: { decisions: DecisionDTO[] }) {
  const list = [...decisions].reverse();
  const verified = decisions.filter((d) => d.verified).length;
  const withConf = decisions.filter((d) => typeof d.confidence === "number");
  const mean = withConf.length ? withConf.reduce((s, d) => s + (d.confidence ?? 0), 0) / withConf.length : null;
  return (
    <section className="app-region app-card decisions" data-container="card" aria-labelledby="decisions-h">
      <RegionHead
        title="Decisions"
        id="decisions-h"
        meta={
          decisions.length > 0
            ? `${decisions.length} soft calls, ${verified} verified by JEV${mean !== null ? `, mean confidence ${fmtPct(mean)}` : ""}`
            : undefined
        }
      />
      {list.length === 0 ? (
        <p className="app-empty-line">No calls to make yet. The CEO asks JEV whenever a choice is soft.</p>
      ) : (
        <ol className="decision-list">
          <AnimatePresence initial={false}>
            {list.map((d) => {
              const conf = typeof d.confidence === "number" ? d.confidence : null;
              return (
                <motion.li
                  key={d.id}
                  layout="position"
                  className="decision-row"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease } }}
                  transition={{ layout: { duration: 0.2, ease } }}
                >
                  <span className="decision-main">
                    <span className="decision-id">{d.decisionId}</span>
                    <span className="decision-action">{d.action}</span>
                  </span>
                  <span className="decision-side">
                    <span className="decision-conf">
                      {conf !== null ? (
                        <>
                          <span className="num">{fmtPct(conf)}</span>
                          <span className="decision-bar" aria-hidden="true">
                            <span className="decision-bar-fill" style={{ ["--v" as string]: String(conf) }} />
                          </span>
                        </>
                      ) : (
                        <span className="decision-noconf">No confidence</span>
                      )}
                    </span>
                    <span className="decision-verified" data-tone={d.verified ? "success" : "warning"}>
                      <ProductIcon name={d.verified ? "checkCircle" : "alertTriangle"} size={16} />
                      <span>{d.verified ? "Verified" : (d.stamp ?? "UNVERIFIED BY JEV")}</span>
                    </span>
                    <span className="decision-clock num">{fmtClock(d.createdAt)}</span>
                  </span>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
      )}
    </section>
  );
}

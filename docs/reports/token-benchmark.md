# Token benchmark: legacy vs v2

Measured on 2026-09-29 by the evals module (`apps/api/src/modules/evals`) on the
`core` fixture suite, replayed through the real ContextService
(`apps/api/src/modules/context`). Deterministic: no network, no model calls,
the same numbers on every run.

## Headline

| | legacy | v2 |
|---|---:|---:|
| calls | 92 | 93 |
| prompt tokens sent | 838,718 | 517,697 |
| cached prompt tokens | 0 | 440,448 |
| billable input tokens | 838,718 | 297,473 |
| largest single prompt | 18,912 | 12,102 |
| output tokens | 4,198 | 4,794 |
| cost at gpt-4o-mini prices | $0.1283 | $0.0475 |

**v2 needs 64.5% fewer billable input tokens than legacy** on the same work
(v2 on OpenAI automatic prefix caching, legacy uncached as recorded).
Before any cache, v2 sends 38.3% fewer prompt tokens. The rest of the gap
comes from the vendor prompt cache, which the v2 layout is built to hit (85.1%
of v2 prompt tokens are cached reads) and which the legacy baseline did not
measure (see Limits).

`POST /api/evals/run` returns this comparison (`savingsPct`) and stores both
runs in `eval_runs`; `GET /api/evals` lists them.

## Per scenario

One scenario is one agent doing one task. Steps are scripted, so both policies
replay the identical tool calls and raw tool outputs; only the prompt policy
differs.

| scenario | role | steps | legacy prompt tokens | legacy max prompt | v2 calls | v2 prompt tokens | v2 cached | v2 billable | v2 max prompt | compactions | savings |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| engineer-discount | engineer | 16 | 155,159 | 14,733 | 16 | 104,122 | 92,672 | 57,786 | 10,696 | 0 | 62.8% |
| qa-flaky-checkout | qa | 14 | 131,576 | 13,667 | 14 | 82,124 | 71,936 | 46,156 | 9,204 | 0 | 64.9% |
| reviewer-payments | reviewer | 9 | 67,916 | 10,535 | 9 | 38,106 | 30,848 | 22,682 | 6,744 | 0 | 66.6% |
| researcher-search-index | researcher | 8 | 59,051 | 10,066 | 8 | 30,437 | 23,936 | 18,469 | 5,972 | 0 | 68.7% |
| security-audit | security | 9 | 63,835 | 8,890 | 9 | 36,672 | 30,336 | 21,504 | 5,699 | 0 | 66.3% |
| lead-plan | lead | 6 | 37,499 | 7,588 | 6 | 21,705 | 16,512 | 13,449 | 4,848 | 0 | 64.1% |
| engineer-settings-migration | engineer | 24 | 290,434 | 18,912 | 25 | 186,032 | 159,488 | 106,288 | 12,102 | 1 | 63.4% |
| designer-landing-hero | designer | 6 | 33,248 | 6,007 | 6 | 18,499 | 14,720 | 11,139 | 3,546 | 0 | 66.5% |

The extra v2 call in the 24-step scenario is the compaction summary, charged
as a fast-tier model call (see method).

## Method

**Fixtures.** `fixtures/core.json`: 8 scenarios across 7 roles, 92 steps,
tool output sizes taken from typical Bun and TypeScript projects (file reads
1 to 10 KB, test runs 3 to 22 KB, diffs about 17 KB, web pages up to 20 KB).
Outputs are generated deterministically at the exact size, shaped like the
real tool (code lines, test lines, search hits, prose). `fixtures/tools.json`
holds a JSON schema for every tool, averaging 89 estimated tokens per tool,
the same weight as legacy's 20 schemas at about 1,800 tokens.

**Counting.** One rule for both policies: the ContextService estimator
(characters / 4) over the system text, the tool schemas as JSON, and every
message (text plus tool call JSON), plus 4 tokens per message and 3 for reply
priming. Legacy's static part is counted as its measured constants.

**Legacy policy**, ported from the legacy Go engine (`legacy.ts`):
- a fixed 2,076-token system prompt and 20 tool schemas (1,800 tokens) on every call
- the first wake's planning nudge, then the task
- tool results cut to 4,000 characters, head 2/3 and tail 1/3 (legacy `ToolOutputMax`), after the 64 KiB file and 16 KiB shell caps
- history unbounded inside a wake (up to 50 turns for a worker); the 39-message trim only runs between wakes, so it never triggers in these single-task scenarios
- no prompt cache

**v2 policy** (`replay.ts`):
- every call is `ContextService.build`: role charter (354 to 387 tokens), only the role's tools (7 to 14), brief, lessons, task packet, rolling summary, recent steps
- tool results go through `ContextService.truncateOutput` (2,000 head + 1,000 tail characters)
- when the build reports `needsCompaction`, `ContextService.compact` folds the oldest half of the steps; the fast-tier summarize call the engine makes in production is charged (200 instruction tokens plus the folded text in, the summary out)
- per-call budget min(12,000, 40% of a 128k window)

**Cache model.** A prefix counts as cached when it is byte-identical to a
prefix of the previous call with the same cache key and at least 1,024 tokens,
rounded down to 128-token blocks, at any message boundary. That is how
OpenAI's automatic prompt caching treats the default model (gpt-4o-mini);
v2 also sends `prompt_cache_key` = hash(role, run) so one agent's calls share
a cache. Legacy is uncached, as in the recorded legacy baseline (0% cache).

**Billable input tokens** = uncached prompt tokens + cached tokens x 0.5, the
gpt-4o-mini cached-to-input price ratio (the smallest cache discount in the
price table, so the most conservative weighting). `savingsPct` = 1 - v2
billable / legacy billable. Costs use the shared `costUsd` helper.

**Pass.** A scenario passes when every call fits the model context window.
All 8 pass under both policies.

## What v2 gets no credit for

- repeat reads of an unchanged file returning a pointer (the fixtures never re-read a file)
- line-range reads and find/replace edits instead of full rewrites (both policies replay the same calls and output sizes)
- per-role output caps (outputs are identical by construction)
- the exact-match response cache for temperature 0 calls
- cache hits inside a message: a cached prefix only counts up to the last whole message it shares with the previous call

## Limits

- The legacy client never set a cache key or `cache_control` and never read cached token counts, so its 0% cache was never observed from vendor usage. If legacy had been served with the same automatic caching (88.5% of its prompt tokens would have been cached reads), the billable savings would be 36.4%. If only declared cache breakpoints count for v2 (Anthropic `cache_control` behavior, which legacy never set), the savings are 47.0%. The 38.3% cut in prompt tokens sent holds under every cache model.
- Token counts are estimates (characters / 4) applied identically to both policies, not vendor tokenizer counts.
- Scripted steps: a real v2 agent may take different steps than a legacy agent on the same task.
- The v2 numbers depend on the ContextService: the evals tests pin them against a deterministic double of the section 7 layout (65.7% on the same fixtures) and require the real ContextService to stay at or above 60%.

## Reproduce

`bun test apps/api/src/modules/evals` replays the suite, pins the
reference-layout numbers (65.7%, 288,028 billable) and checks the real
ContextService stays at or above 60%. The headline figures above (64.5%,
297,473) come from the real ContextService and move when the context module
changes; they are not pinned. With the API running, `POST /api/evals/run` with body `{}` stores a
new pair of runs and returns `savingsPct`.

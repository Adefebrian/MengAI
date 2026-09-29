# 1. Record architecture decisions

Date: 2026-08-21

## Status

Accepted

## Context

We need to record the architectural decisions made on this project: not just what was
decided, but why, so that a decision can be understood and revisited later without
reconstructing the reasoning from git history or from whoever happens to remember the
discussion. This matters especially for decisions that are expensive to reverse (a stack
choice, a new dependency, a module boundary) and for the kind of gatekeeping `jal-architect`
already does before a new technology enters a JAL project.

## Decision

We will use Architecture Decision Records, as described by Michael Nygard in
"Documenting Architecture Decisions".

Each ADR is a short markdown file under `docs/adr/`, numbered sequentially
(`NNNN-title-with-dashes.md`), and follows this template:

- **Title**: a short noun phrase naming the decision, prefixed with its number.
- **Date**: when the decision was made.
- **Status**: `Proposed`, `Accepted`, `Deprecated`, or `Superseded by ADR-NNNN`.
- **Context**: the forces at play, the problem being solved, and any constraints that
  shaped the decision (technical, business, or organizational).
- **Decision**: the change being proposed or made, stated plainly.
- **Consequences**: what becomes easier or harder as a result, including trade-offs
  accepted knowingly rather than discovered later.

ADRs are immutable once accepted: a decision that changes gets a new ADR that supersedes
the old one, rather than an edit that erases the original reasoning. This keeps the record
a genuine history, not a single always-current document.

## Consequences

- Every significant decision (a new dependency, a new service in `services/`, a change to
  a module boundary rule enforced by `tools/check-boundaries.ts`, a stack choice) gets a
  short written record, findable in one place.
- Reviewing `docs/adr/` becomes part of onboarding onto this codebase, and part of
  `jal-architect`'s job when vetting a proposed change against what was already decided.
- This adds a small amount of process: a decision worth reversing later is worth the few
  minutes it takes to write down why it was made in the first place.

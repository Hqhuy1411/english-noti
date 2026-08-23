# 0007 — `lesson.mjs` is the only file Phase 2 changes

**Status:** accepted · **Date:** 2026-08 · **Applies to:** `services/notifier/src/`

## Context

Phase 1 delivers a punctual message with placeholder content. Phase 2 replaces the
content with real English-learning material, probably from a separate lesson
service. Scheduling, delivery and logging are the parts that were expensive to get
right and are now verified end to end.

## Decision

`services/notifier/src/lesson.mjs` is the **only** file that changes when real
lesson content arrives. It has one job: return the message body. Scheduling
(`template.yaml`), delivery (`telegram.mjs`), logging (`logger.mjs`) and the
handler (`handler.mjs`) stay untouched.

Keep the seam that narrow.

## Rejected alternatives

- **Have the handler compose content inline** — couples the verified delivery path
  to the volatile content path; every content change risks the send path.
- **Have the notifier call the lesson service directly from `handler.mjs`** — the
  handler would grow retry, timeout and fallback logic for content, blurring which
  failure the `Errors` metric is reporting.
- **Wait for Phase 2 to decide the boundary** — the boundary is cheapest to place
  now, while the file is a placeholder and there is nothing to migrate.

## Consequences

- A Phase 2 content change cannot break the schedule or the send path. That is the
  entire point.
- `lesson.mjs` receives `EnvironmentName` so it can prefix `[TEST]` (see 0005) —
  the one piece of environment awareness inside the seam.
- If Phase 2 needs the message *format* to change (buttons, HTML parse mode), that
  reaches into `telegram.mjs` and this ADR needs revisiting rather than quietly
  widening.
- A lesson **service** (its own nested stack) is additive under 0002 and does not
  contradict this ADR: the notifier still only calls `lesson.mjs`.

## Evidence

`services/notifier/src/lesson.mjs`; `README.md` "Phase 2".

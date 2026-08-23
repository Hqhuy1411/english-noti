# 0003 — EventBridge Scheduler with `ScheduleV2`, not Actions cron, not EventBridge Rules

**Status:** accepted · **Date:** 2026-08 · **Applies to:** `services/*/template.yaml`

## Context

The reminder must arrive at 21:00 **Asia/Ho_Chi_Minh**, daily. Vietnam has no DST,
but the requirement is stated in local time and should stay stated that way — UTC
arithmetic done by hand is a recurring source of off-by-an-hour bugs.

## Decision

`Type: ScheduleV2` (EventBridge Scheduler), with `ScheduleExpressionTimezone:
Asia/Ho_Chi_Minh` and `FlexibleTimeWindow: OFF`.

## Rejected alternatives

- **GitHub Actions cron** — rejected on punctuality. It routinely runs 5–30 minutes
  late and can skip runs entirely under load. Unacceptable for something whose
  whole product value is arriving at a fixed time. **Do not reintroduce it** for
  anything that must be punctual.
- **`Type: Schedule`** (the old EventBridge Rules path) — **cannot express a
  timezone** at all. It would force hand-converted UTC cron, which is exactly the
  failure mode being avoided.
- **A long-running process with an in-app timer** — a server to keep alive, for 30
  invocations a month.

## Consequences

- Schedule intent is readable in the template in the same timezone the requirement
  is written in. No conversion step to get wrong.
- Measured latency here was **~36 s** from the scheduled moment to handler start
  with `FlexibleTimeWindow: OFF`. Far better than Actions cron, but **not
  second-accurate** — do not promise second-accuracy on top of it.
- The deploying identity needs `scheduler:*` permissions, discovered late; see
  `docs/DEPLOY-LOG.md` round 6.
- A message's own timestamp is formatted with `Intl` in the same zone, so a
  received message is itself proof the schedule fired at the right local time.

## Evidence

`docs/DEPLOY-LOG.md` round 7 records the observed fire time and the 36 s figure.

# 0005 — Two environments from one service template, via `EnvironmentName`

**Status:** accepted · **Date:** 2026-08 · **Applies to:** `template.yaml`, `services/*/template.yaml`

## Context

The schedule is the risky part of this system and the slowest to verify: waiting
until 21:00 to find out a change broke it is not a test loop. A way to fire the
real code path on demand was needed — without any chance of a test firing being
mistaken for the real reminder.

## Decision

The root template instantiates `services/notifier/template.yaml` **twice**, as
`NotifierProd` and `NotifierTest`. An `EnvironmentName` parameter (`prod` | `test`)
suffixes every resource name — function, log group, schedule — so both live in one
account without collision. It is also passed into the function, so `lesson.mjs`
prefixes a test message with `[TEST]`.

- **prod**: `cron(0 21 * * ? *)`, daily, always `ENABLED`.
- **test**: a one-shot `at(yyyy-mm-ddThh:mm:ss)`.

Adding a third environment is a parameter value, not a new template.

## Rejected alternatives

- **A second copy of the service template** — two files drifting apart, and the
  test path stops being the same code as the prod path, which is the only reason
  the test is worth anything.
- **A separate AWS account per environment** — right answer at team scale, heavy
  overhead for one person and one Lambda.
- **Testing only by `lambda invoke`** — exercises the handler but **not the
  schedule**, which is the part most likely to be wrong.
- **A repeating test schedule** — would keep firing and sending messages after the
  test was over.

## Consequences

- A test firing is never mistakable for the real reminder: different function,
  different log group, and a `[TEST]` prefix in the message.
- **One-shots do not repeat**, so re-arming means redeploying with a new value.
  `TestScheduleExpression` has deliberately **no default**: an `at(...)` already in
  the past silently never fires and reports nothing, so it must be a conscious
  choice on every deploy. `/deploy` computes a fresh one.
- After firing, a one-shot stays `ENABLED` with its past expression; it does not
  self-delete. **A lingering ENABLED one-shot is not pending work** — this looks
  alarming in `/status` and is not.
- Doubles the resource count in the account.

## Evidence

`.claude/commands/deploy.md`; `docs/DEPLOY-LOG.md` "What is deployed right now".

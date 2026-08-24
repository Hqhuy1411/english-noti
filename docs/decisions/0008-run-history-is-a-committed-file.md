# 0008 — Run history is a committed file, harvested from CloudWatch

**Status:** accepted · **Date:** 2026-08 · **Applies to:** `docs/RUN-HISTORY.md`, `scripts/`

## Context

The only evidence this system works is that it fired and a message arrived. That
evidence lived exclusively in CloudWatch Logs, which is configured with
`LogRetentionDays: 30` — a **rolling window, not a record**. On day 31 the proof
that the reminder ran on day 1 is gone, permanently and silently.

`docs/DEPLOY-LOG.md` records deploys, but nothing recorded *runs*. So the question
"has this actually been firing every night?" was answerable for a month and
unanswerable after that, and nobody would notice the moment it stopped being
answerable.

A run record also has to be readable **without AWS credentials** — on GitHub, in a
pull request, by a teammate who has not been granted access to this account.

## Decision

`docs/RUN-HISTORY.md` is a committed markdown table, one row per invocation, and
it is **the durable record**. `scripts/record-run-history.mjs` harvests runs out of
CloudWatch and merges them in.

The merge is **additive and idempotent**, keyed on `requestId`: existing rows are
never rewritten or removed, only new ones appended. That is the property that
matters — once a run's row is in the file, it survives CloudWatch forgetting the
run. The file is therefore not a cache of CloudWatch and must never be regenerated
from scratch; that would delete every row older than 30 days.

The script lives in a **root `scripts/`**, not `services/notifier/scripts/`,
because it needs AWS credentials and that directory is required to stay AWS-free
(`.claude/rules/tests-and-scripts.md`) so it can isolate a Telegram fault from an
AWS fault.

`chatId` is not recorded, matching `docs/DEPLOY-LOG.md`.

## Rejected alternatives

- **A DynamoDB table or S3 object written by the Lambda.** Genuinely durable, and
  the right answer if the *application* needed the state (Phase 2's "don't repeat
  yesterday's word" may still want it — backlog 0001, question 2). Rejected *for
  this purpose*: it adds infrastructure, IAM and a new failure mode on the send
  path, and it still cannot be read from GitHub or reviewed in a PR, which is the
  requirement here.
- **Raising `LogRetentionDays` to a year.** Postpones the loss instead of fixing
  it, costs storage, and still leaves the history invisible outside the AWS
  console.
- **Having the Lambda append to the repo.** Not possible — the function has no
  checkout and no push credentials, and giving it any would be a much worse idea
  than the problem it solves.
- **A hand-written history, like `DEPLOY-LOG.md`.** That file works because
  deploys are rare and interesting. Runs are daily and boring, so a manual log
  would be skipped within a week and then silently wrong — worse than none.

## Consequences

- **The script must be run at least once every 30 days**, or runs expire from
  CloudWatch unharvested and are lost for good. It is wired into `/status`, which
  is the moment someone is already looking at run outcomes.
- The file grows by roughly 365 rows a year. Acceptable; split by year if it stops
  being scannable.
- A `manual` row (`scheduledTime: null`) is a hand-triggered invoke and is **not**
  evidence the schedule works — the column exists so the two are never conflated.
- A run that started and logged no outcome is recorded as `no outcome logged`
  rather than dropped, so a timeout or crash leaves a visible trace.
- The harvest is one-way. Nothing reads `RUN-HISTORY.md` back; it is a record for
  humans, not application state.

## Evidence

`scripts/record-run-history.mjs`; `docs/RUN-HISTORY.md`, whose first six rows were
harvested on 2026-08-24 and reconcile with `aws logs filter-log-events` for both
log groups — prod at 21:00 on 08-23 and 08-24, the test one-shot at 09:00 on 08-24.

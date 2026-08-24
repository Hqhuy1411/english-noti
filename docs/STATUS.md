# Status

**Read this first, before starting any work.** It is the index: what is live, what
is open, and where the detail lives. If it disagrees with reality, fixing it is
part of the next commit.

Last reviewed: 2026-08-24.

## Phase

Phase 1 is **done and deployed**: a Lambda fires at 21:00 Asia/Ho_Chi_Minh and
sends a Telegram message, with placeholder content. Phase 2 replaces the content
with real English-learning material.

## Live right now

Root stack `english-reminder` in `ap-southeast-1`, two nested stacks:

| Environment | Function | Schedule |
|---|---|---|
| prod | `english-reminder-notifier-prod` | `english-reminder-prod`, `cron(0 21 * * ? *)` |
| test | `english-reminder-notifier-test` | `english-reminder-test`, **parked** — `DISABLED` |

Deliberately **outside** the stack: the SSM SecureString bot token (ADR 0004) and
SAM's managed artifact bucket. Deleting the stack removes neither.

The test environment was **parked on 2026-08-24** at the user's request, once prod
was confirmed working: `TestScheduleState=DISABLED`, so nothing fires on a clock.
The function, its log group and its logs all remain, so Phase 2 can re-arm the
smoke test with `/deploy` — which now passes `TestScheduleState=ENABLED`
explicitly, because CloudFormation would otherwise inherit `DISABLED` and the
smoke test would silently never fire.

A lingering one-shot with a past expression is **not** pending work either way —
one-shots do not self-delete (ADR 0005).

Full account-specific detail: `docs/DEPLOY-LOG.md`. Run `/status` for a live check.

## Open work

| # | Item | State |
|---|---|---|
| [0001](backlog/0001-real-lesson-content.md) | Real lesson content behind the `lesson.mjs` seam | open — the Phase 2 headline |
| [0002](backlog/0002-rotate-bot-token.md) | Rotate the bot token exposed in a setup transcript | open — security, do before sharing the repo |

Known Phase 2 ideas **not yet ticketed**, so nobody plans against them as if they
were decided: a separate `services/lesson/` nested stack, interactive
"done / snooze" buttons (needs API Gateway plus a Telegram webhook), and a
CloudWatch alarm on the function's `Errors` metric wired to SNS. They are listed in
`README.md` under "Phase 2". Ticket one when it becomes real.

## Latest decision

**ADR 0008** — run history is a committed file (`docs/RUN-HISTORY.md`).
Index: `docs/decisions/README.md`. Next number is **0009**.

## Where things are

| Question | File |
|---|---|
| How do I build / deploy / verify / tear down? | `docs/RUNBOOK.md` |
| What was actually deployed, and what blocked it? | `docs/DEPLOY-LOG.md` |
| Did it fire, and did it send? | `docs/RUN-HISTORY.md` — refresh with `node scripts/record-run-history.mjs` |
| Why is it built this way? | `docs/decisions/` |
| What am I not allowed to break? | `CLAUDE.md` + `.claude/rules/` |
| A deploy just rolled back | `cfn-deploy-triage` skill |
| A Telegram message did not arrive | `telegram-bot-ops` skill |

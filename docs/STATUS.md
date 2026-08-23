# Status

**Read this first, before starting any work.** It is the index: what is live, what
is open, and where the detail lives. If it disagrees with reality, fixing it is
part of the next commit.

Last reviewed: 2026-08-23.

## Phase

Phase 1 is **done and deployed**: a Lambda fires at 21:00 Asia/Ho_Chi_Minh and
sends a Telegram message, with placeholder content. Phase 2 replaces the content
with real English-learning material.

## Live right now

Root stack `english-reminder` in `ap-southeast-1`, two nested stacks:

| Environment | Function | Schedule |
|---|---|---|
| prod | `english-reminder-notifier-prod` | `english-reminder-prod`, `cron(0 21 * * ? *)` |
| test | `english-reminder-notifier-test` | `english-reminder-test`, one-shot `at(...)` |

Deliberately **outside** the stack: the SSM SecureString bot token (ADR 0004) and
SAM's managed artifact bucket. Deleting the stack removes neither.

A lingering `ENABLED` one-shot test schedule with a past expression is **not**
pending work — one-shots do not self-delete (ADR 0005).

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

**ADR 0007.** Index: `docs/decisions/README.md`. Next number is **0008**.

## Where things are

| Question | File |
|---|---|
| How do I build / deploy / verify / tear down? | `docs/RUNBOOK.md` |
| What was actually deployed, and what blocked it? | `docs/DEPLOY-LOG.md` |
| Why is it built this way? | `docs/decisions/` |
| What am I not allowed to break? | `CLAUDE.md` + `.claude/rules/` |
| A deploy just rolled back | `cfn-deploy-triage` skill |
| A Telegram message did not arrive | `telegram-bot-ops` skill |

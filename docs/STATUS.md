# Status

**Read this first, before starting any work.** It is the index: what is live, what
is open, and where the detail lives. If it disagrees with reality, fixing it is
part of the next commit.

Last reviewed: 2026-08-25.

## Phase

Phase 1 (Lambda fires at 21:00 Asia/Ho_Chi_Minh, sends a Telegram message) and
Phase 2.1 (real, stateful English-learning content behind that message) are both
**done and deployed**. The 21:00 message now carries a curated curriculum item —
vocabulary or a technical concept from the learner's own field — chosen with
DynamoDB-backed spaced repetition, not placeholder text. Phase 2.2 (inbound
replies, backlog 0003) is next.

## Live right now

Root stack `english-reminder` in `ap-southeast-1`, three nested stacks:

| Environment | Function | Schedule |
|---|---|---|
| prod | `english-reminder-notifier-prod` | `english-reminder-prod`, `cron(0 21 * * ? *)` |
| test | `english-reminder-notifier-test` | `english-reminder-test`, **parked** — `DISABLED` |

Plus `services/study/`'s nested stack: table `english-reminder-study`
(`PAY_PER_REQUEST`, `GSI1` for due-item queries — key schema in ADR 0010, read
by `lesson.mjs` in-process, no Lambda of its own). Both notifier environments
read and write it; `test` writes only the `#test`-suffixed lesson key
(`.claude/rules/study-data.md`), never the key a real submission is graded
against.

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
| [0001](backlog/0001-real-lesson-content.md) | Real lesson content behind the `lesson.mjs` seam | **done 2026-08-25** — see ADR 0009/0010 |
| [0002](backlog/0002-rotate-bot-token.md) | Rotate the bot token exposed in a setup transcript | open — **urgency raised**: the repo is now public and names the bot |
| [0003](backlog/0003-inbound-reply-channel.md) | Inbound reply channel: Telegram webhook, secret-token + allowlist auth, `update_id` de-dup | open — Phase 2.2, needs 0001 (now satisfied) |
| [0004](backlog/0004-speaking-practice-no-llm.md) | Speaking practice, no LLM: S3 audio, Transcribe, EventBridge job-state-change, local metrics | open — Phase 2.3, needs 0003 |
| [0005](backlog/0005-llm-coaching.md) | LLM coaching: provider/model ADR, `llm.mjs` seam, prompt caching, delivery-never-depends-on-LLM | open — Phase 2.4, needs 0004 |
| [0006](backlog/0006-weekly-digest-and-tuning.md) | Weekly digest and content-split tuning | open — Phase 2.5, needs 0001 (now satisfied)/0004/0005 |
| [0007](backlog/0007-technical-concept-content.md) | Technical-concept curriculum extension (MVCC, WAL, Bloom filter, gossip, index, SSTable) | **done 2026-08-25** — opened and closed together, built in `27eaff0` before the ticket existed |

Known Phase 2 ideas **not yet ticketed**, so nobody plans against them as if they
were decided: a separate `services/lesson/` nested stack, and a CloudWatch alarm
on the function's `Errors` metric wired to SNS. They are listed in `README.md`
under "Phase 2". Ticket one when it becomes real.

(The interactive "done / snooze" buttons idea previously listed here is now
covered by ticket 0003's inline keyboard and webhook.)

## Latest decision

**ADR 0010** — the study table's single-table key schema (GSI1 for due items, the
spoken-not-read SRS invariant). **ADR 0009** answered backlog 0001's three open
questions (curated committed curriculum, DynamoDB state, module not service) and
widened the `lesson.mjs` seam to async with a `replyMarkup` parameter, superseding
**ADR 0007**. Index: `docs/decisions/README.md`. Next number is **0011**.

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

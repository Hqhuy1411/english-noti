# 0010 — The study table: single-table key schema

**Status:** accepted · **Date:** 2026-08 · **Applies to:** `services/study/`, `services/notifier/src/lesson.mjs`, `services/coach/`

## Context

ADR 0009 decided the lesson content needs per-user, per-word state in DynamoDB.
This ADR fixes the key schema so `services/study/`, `lesson.mjs`, and the future
coach service (backlog 0003/0004) all agree on it before any of them are built
against it.

## Decision

One DynamoDB table (`StudyTable`, on-demand billing), partitioned entirely by
user:

| PK | SK | Holds |
|---|---|---|
| `USER#<chatId>` | `PROFILE` | level, streak, the work/daily/pronunciation split |
| `USER#<chatId>` | `ITEM#<wordId>` | SRS state: `box`, `dueOn` (`YYYY-MM-DD`), `timesSpoken`, `timesFailed` |
| `USER#<chatId>` | `LESSON#<YYYY-MM-DD>` | the lesson actually sent: items, taskType, prompt, expectedText, messageId |
| `USER#<chatId>` | `SUB#<ts>` | a submission: transcript, metrics, feedback, score |

**GSI1**: `GSI1PK = USER#<chatId>#DUE`, `GSI1SK = <dueOn>` — supports "everything
due on or before today" as a single `Query` with a key condition, instead of a
`Scan` over every item the user has ever seen.

In the `test` environment, the lesson item's key is `LESSON#<YYYY-MM-DD>#test`,
not `LESSON#<YYYY-MM-DD>`. This follows ADR 0005's rule that a test firing must
never be mistakable for a real one: without the suffix, a one-shot test schedule
firing on the same calendar day as a real send would overwrite the real
`LESSON#<date>` record, corrupting the record the coach service needs to grade a
real submission.

## Invariants this schema exists to enforce

1. **A word's SRS box advances only when the word was spoken in a submission,
   never because it appeared in a message the user may not have read.** This is
   the line between this system and a flashcard app that just cycles through a
   deck. `ITEM#<wordId>.box` must only be written by the code path that also
   writes a `SUB#<ts>` record confirming the word was spoken (see backlog
   0004's `GradeFunction`). Selecting a word into a lesson (writing it into
   `LESSON#<date>.items`) must never itself touch `box`.
2. **`LESSON#<date>` is written at send time and is the record the coach service
   reads back when a voice note or text reply arrives.** It is how the grader
   knows which sentence the user was actually asked to say (`expectedText`, for
   `shadow` tasks) and which words were on offer (`items`), so a submission can be
   graded against something concrete instead of guessed at. Without this record a
   voice note has nothing to be checked against.

## Rejected alternatives

- **A separate table per record type** (e.g. `ProfileTable`, `ItemsTable`,
  `LessonsTable`, `SubmissionsTable`). Every query that needs more than one kind
  of record for a user — e.g. the coach service reading `LESSON#<date>` and then
  writing to `ITEM#<wordId>` — would become two round trips against two tables
  instead of one table already partitioned by user. Buys nothing at this scale.
- **A GSI keyed by word instead of by due-date.** The actual query need is "what
  is due for this user, in order," never "who has this word," so a due-date GSI
  fits the read pattern and a word-keyed one would not answer the question that
  gets asked at 21:00 every day.
- **Storing audio in the table.** DynamoDB item size limits (400 KB) and
  its per-request pricing make it a poor fit for binary voice data; audio belongs
  in S3 (backlog 0004's `AudioBucket`), and the table only ever holds a reference
  to it if one is needed — currently it does not even need that, since the
  transcript and metrics derived from the audio are what get persisted.
- **Skipping the `#test` suffix on `LESSON#<date>` and relying on the test
  schedule never firing the same day as prod.** True today because the test
  schedule is parked (`docs/STATUS.md`), but relying on operational discipline
  instead of a key-space guarantee is exactly the kind of thing that breaks
  quietly the first time someone re-arms the test schedule for same-day
  verification, which task 1.16 of the Phase 2.1 plan does routinely.

## Consequences

- `services/study/src/ddb.mjs` (ADR 0009 / rule `.claude/rules/study-data.md`)
  hand-writes marshalling for this schema; there is no `lib-dynamodb` guarantee in
  the Lambda runtime to lean on.
- `services/study/src/srs.mjs` selects due items via the `GSI1PK`/`GSI1SK` query,
  capped and ordered per the daily-load rule in `.claude/rules/study-data.md`; it
  never reads or writes `box` itself unless it is processing a confirmed spoken
  submission.
- `chatId` is not a secret — `CLAUDE.md` already establishes that `TELEGRAM_CHAT_ID`
  is an ordinary env var — but it is personal, and appears throughout every PK in
  this table. It must not appear in a log line that does not need it (e.g. a
  generic `lesson.sent` log can carry a request id without carrying the chat id
  redundantly next to it, per existing logging conventions in
  `.claude/rules/lambda-src.md`).
- Nothing in this table is ever read on the send path without a fallback: ADR
  0009's delivery-never-depends-on-a-network-call invariant applies to reads from
  this table exactly as it applies to reads from an LLM.

## Evidence

`.claude/plans/phase-2-study-service.md` §2.1; `docs/decisions/0005-one-template-two-environments.md`
(test-firing-unmistakable rule); `docs/backlog/0001-real-lesson-content.md`;
`docs/backlog/0004-speaking-practice-no-llm.md` (the coach service that reads
`LESSON#<date>` back).

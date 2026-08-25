---
paths:
  - "services/study/**"
  - "services/notifier/src/study/**"
---

# Study data conventions

Loaded when editing the study service. Reasoning and rejected alternatives live in
`docs/decisions/0009` (content source, state, seam) and `docs/decisions/0010`
(key schema). This file is the operational summary, not a restatement of either.

## Where the code actually is

`services/study/` owns only `template.yaml` (the table). The marshalling, the
selection logic and the curriculum data live at
`services/notifier/src/study/` — `ddb.mjs`, `srs.mjs`, `curriculum.json` — next
to the notifier code that is their only consumer, not inside `services/study/`.

This is because `services/notifier/template.yaml` sets `CodeUri: src/`, so
`sam build` packages `services/notifier/src/` only; anything under
`services/study/src/` would never be uploaded and the import would fail at
runtime. Verified: `sam build`, then `.aws-sam/build/NotifierProd/NotifierFunction/`
contains the notifier's own files plus a `study/` subdirectory with all three
files.

Don't "fix" this by moving the code back into `services/study/` to match the
directory name — that breaks the build. It also isn't shared via a Lambda layer
yet, for the same reason ADR 0009 rejected a lesson-building Lambda: there is
only one consumer today, so there is nothing to share. When the coach service
(backlog 0003) needs `srs.mjs`, that is the moment to choose between a layer and
duplication — a layer needs a `package.json` for Node to resolve a bare
specifier, which collides with ADR 0001 (zero npm dependencies) and has to be
faced then, with real information, not assumed away now.

## Key patterns

Single table, `StudyTable`, on-demand billing, partitioned by `USER#<chatId>`:

| SK | Holds |
|---|---|
| `PROFILE` | level, streak, work/daily/pronunciation split |
| `ITEM#<wordId>` | SRS state: `box`, `dueOn` (`YYYY-MM-DD`), `timesSpoken`, `timesFailed` |
| `LESSON#<YYYY-MM-DD>` (prod) / `LESSON#<YYYY-MM-DD>#test` (test env) | the lesson actually sent |
| `SUB#<ts>` | a submission: transcript, metrics, feedback, score |

`GSI1PK = USER#<chatId>#DUE`, `GSI1SK = <dueOn>` — query due items with a key
condition, never a `Scan`.

## Two prohibitions, not suggestions

- **Never write `ITEM#<wordId>.box` from lesson selection.** Selecting a word into
  a lesson (writing `LESSON#<date>.items`) must not touch `box`. `box` only
  advances from the grading path, after a `SUB#<ts>` record confirms the word was
  spoken. If you're editing code that builds a lesson and it also bumps a box,
  that's the bug this rule exists to catch.
- **Never write to `LESSON#<date>` (no `#test` suffix) from a non-`prod`
  environment.** The test environment always uses the `#test`-suffixed key. A
  same-day test firing that overwrites the real `LESSON#<date>` corrupts the
  record the coach service needs to grade a real submission.

## No `lib-dynamodb` / `util-dynamodb`

Not confirmed present in the `nodejs22.x` runtime bundle (only `@aws-sdk/client-ssm`
is confirmed there, per `services/notifier/src/config.mjs`). Marshalling is
hand-written in `services/notifier/src/study/ddb.mjs` — S/N/BOOL/L/M only, no
`lib-dynamodb` convenience wrapper. Don't add it back as a dependency without
reopening ADR 0001 first.

## `srs.mjs` is pure

Selection logic (which items are due, which new words to introduce, box
transitions) lives in `services/notifier/src/study/srs.mjs` as **pure functions — no I/O**.
It takes data in, returns a decision, does not call DynamoDB itself. This is what
lets it run under `node --test` with no AWS credentials; the daily-load and
gap-handling rules below are exactly the kind of logic that needs to be testable
without a live table.

## Daily load cap

- **At most 6 review items per day**, oldest `dueOn` first.
- Overdue items **queue**, they do not all arrive at once — a week away should not
  turn into a 40-item pile the day you come back.
- **After a gap of more than 3 days, the returning day is review-only** — no new
  words, and keep the task light (e.g. a short `shadow` task). The point is to
  make returning easy, not to penalize it.

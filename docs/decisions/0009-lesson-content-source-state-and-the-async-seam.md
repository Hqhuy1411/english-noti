# 0009 — Lesson content: committed curriculum, DynamoDB state, and an async `buildLesson` seam

**Status:** accepted · **Date:** 2026-08 · **Applies to:** `services/notifier/src/`, `services/study/`

## Context

Backlog 0001 asks three questions before any content code is written: where does
content come from, does it need state, and does it need a separate service. ADR
0007 drew the Phase 2 boundary at `lesson.mjs` and said explicitly that if the
message *format* ever needs to change, that reaches `telegram.mjs` and the ADR
must be revisited rather than quietly widened. Both now happen at once — a lesson
needs an async content source, and the coach service (backlog 0003) needs an
inline keyboard — so this ADR both answers the three questions and revisits 0007.

## Decision

### Q1 — where content comes from

A **curated curriculum committed to the repo** at `services/study/data/curriculum.json`.
It is read at send time, not generated per-message and not fetched from an
external feed. Generation is not ruled out forever: backlog 0005 adds it later as
an *enrichment* layered on top of the committed file, which stays the fallback
even after an LLM is introduced.

### Q2 — does it need state

**Yes, DynamoDB.** Stateless-and-deterministic (day-of-year indexing into a fixed
list) is ruled out explicitly, not by omission: it satisfies "two consecutive days
differ," but it cannot do spaced repetition, cannot know which words the user
actually spoke out loud, and will silently re-teach a word forever after it is
already mastered. Since a word is only meant to graduate once it has been spoken
in a submission (see ADR 0010), tracking per-word state is not optional — it is
the entire point of the exercise.

### Q3 — module or separate service

The notifier keeps reading through `lesson.mjs`; a new `services/study/` nested
stack owns **only the table and the curriculum data** — no lesson-building Lambda.
`lesson.mjs` itself does the DynamoDB read/write and the curriculum fallback,
in-process, inside the notifier's own Lambda.

## Rejected alternatives

- **Generating every lesson with an LLM.** Puts a network dependency and a new
  failure mode directly on the send path that Phase 1 was built and measured to
  make reliable (ADR 0003, ~36 s). Arrives later as an enrichment, never as the
  only source.
- **An external vocabulary feed.** Needs a real parser, which ADR 0001 (zero npm
  dependencies) forbids without being reopened; nothing here justifies reopening it.
- **An SSM parameter as a cursor.** One scalar value has no room for per-item
  scheduling (each word needs its own `dueOn`), and it collides with the
  SecureString-for-secrets convention (ADR 0004) — this state is not a secret.
- **S3 as a document store.** Read-modify-write on a JSON blob races once the
  coach service (backlog 0003/0004) also writes SRS state after grading a
  submission; DynamoDB's conditional writes do not have that problem.
- **A lesson-building Lambda the notifier invokes.** Adds a second failure point
  on the send path for a single consumer, with no gain over an in-process module
  call — the exact anti-pattern ADR 0007 already rejected ("call the lesson
  service directly from `handler.mjs`").
- **Putting the table in the notifier's own stack.** The coach service (backlog
  0003) needs to read and write the same table, and a table owned by the
  notifier's nested stack could not outlive the notifier cleanly if the notifier
  stack were ever replaced.

## Amendment to ADR 0007

ADR 0007 restricted Phase 2 to `lesson.mjs` alone and said a message-format change
must revisit the ADR rather than widen the seam quietly. Two things now cross that
line, both verified against the code before being written down here:

1. **`buildMessage()` was never awaited.** `services/notifier/src/handler.mjs`
   line 29 reads exactly:

   ```js
   const message = await sendMessage(token, chatId, buildMessage());
   ```

   Every real content source (DynamoDB, later an LLM) is async, so the seam
   itself must become async. The new export is:

   ```js
   // services/notifier/src/lesson.mjs
   export async function buildLesson({ now = new Date(), environment } = {})
     // -> { text, replyMarkup, lessonId }
   ```

   `handler.mjs` changes by exactly one line: `buildMessage()` becomes
   `await buildLesson(...)` (plus destructuring `text`/`replyMarkup`/`lessonId`
   out of the result). Scheduling, delivery and logging remain untouched, which is
   what ADR 0007 actually protects — the file list, not the sync/async keyword.

2. **`telegram.mjs`'s `sendMessage` gains a fourth, optional parameter.** Today it
   is `sendMessage(token, chatId, text)` — verified, three parameters, no
   `replyMarkup`. It becomes `sendMessage(token, chatId, text, replyMarkup)`. When
   `replyMarkup` is `undefined` (every call until backlog 0003 ships), the request
   body sent to Telegram must be byte-identical to today's, so the nine existing
   tests in `test/notifier.test.mjs` stay green without being rewritten. This is
   the inline-keyboard need (`🎤 Nói` / `📝 Viết` / `📖 Thêm ví dụ` / `😴 Bỏ qua
   hôm nay`) from backlog 0003, arriving one ADR early because the seam has to be
   widened anyway.

Three call sites of `buildMessage` were found by grep, matching what the plan
claimed: `services/notifier/src/handler.mjs`, `services/notifier/scripts/send-now.mjs`,
and `services/notifier/test/notifier.test.mjs`. All three update in lockstep to
`await buildLesson(...)`.

ADR 0007's own Status line is set to `superseded by 0009`; the file stays in place
as the record of what was originally decided and why.

## Invariant this decision buys

**Message delivery must never depend on a network call to a content source.** If
DynamoDB is unreachable, or a later LLM enrichment (backlog 0005) fails or times
out, `buildLesson` falls back to a deterministic pick from the committed
`curriculum.json` and **still sends**. Phase 1 paid to make delivery reliable
(ADR 0003); Phase 2 does not get to trade that away for richer content. This is
the acceptance bar for backlog 0001's task 1.13 (fallback test) and for the deploy
verification in task 1.16.

## Consequences

- `services/study/template.yaml` owns `StudyTable` (DynamoDB, on-demand) and
  `services/study/data/curriculum.json`; it does not own a Lambda function.
- `lesson.mjs` grows a DynamoDB dependency (via `services/study/src/ddb.mjs`) and
  becomes the one place in the notifier that talks to another AWS resource beyond
  SSM and Telegram — still inside the seam ADR 0007 defined, now async.
- `handler.mjs`, `telegram.mjs` and `test/notifier.test.mjs` all change, which
  ADR 0007 said would require revisiting the ADR rather than quietly widening —
  this document is that revisit.
- The `[TEST]` prefix (ADR 0005) and the `test` environment's write isolation
  (`LESSON#<date>#test`, ADR 0010) both have to survive inside `buildLesson`; this
  is covered by acceptance criteria in backlog 0001, not repeated here.

## Evidence

`services/notifier/src/handler.mjs:29`; `services/notifier/src/lesson.mjs`;
`services/notifier/src/telegram.mjs`; grep for `buildMessage` across
`services/notifier/`; `docs/backlog/0001-real-lesson-content.md`;
`.claude/plans/phase-2-study-service.md` §2.2.

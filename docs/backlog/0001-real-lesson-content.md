# 0001 — Real lesson content behind the `lesson.mjs` seam

**State:** done
**Opened:** 2026-08-23 · **Closed:** 2026-08-25

## Goal

The daily 21:00 message carries actual English-learning content instead of the
Phase 1 placeholder — something worth reading on the day it arrives, and not the
same thing every day. What "content" means concretely (vocabulary item, phrasal
verb, sentence to translate, or a mix) is part of this ticket to decide, and the
decision becomes an ADR.

## Why now

Phase 1 delivers a punctual, verified, observable message with nothing useful in
it. Every day it fires, the system trains the recipient to ignore it. Punctuality
is already solved and measured (~36 s, ADR 0003); content is the only thing between
this and being useful.

## Constraints

- **ADR 0007** — `services/notifier/src/lesson.mjs` is the **only** file that
  changes in the notifier. Scheduling, delivery and logging stay untouched. If the
  message *format* must change (buttons, HTML parse mode), that reaches
  `telegram.mjs` and needs ADR 0007 revisited, not quietly widened.
- **ADR 0001** — no npm dependencies. If content comes from a feed that needs real
  parsing, that is a reason to revisit 0001 explicitly, not to add a `package.json`.
- **ADR 0002** — a lesson *service* is a new `services/lesson/template.yaml` plus
  one `AWS::Serverless::Application` block. Additive; the notifier's nested stack
  is untouched.
- **ADR 0005** — a test firing must stay unmistakable. `lesson.mjs` keeps the
  `[TEST]` prefix, and it must survive whatever content logic replaces it.
- Content must not be a secret and must not embed one.

## Open questions (decide before building)

1. **Where does content come from?** A static curriculum committed to the repo, a
   generated lesson, or an external source? Static is testable offline and costs
   nothing; generated is richer and adds a runtime dependency and a failure mode
   on the send path.
2. **Does it need state?** "Don't repeat yesterday's word" requires storage —
   DynamoDB, or an SSM parameter as a cursor. Stateless-and-deterministic
   (day-of-year into a fixed list) needs none and is worth ruling out first.
3. **Service or module?** A separate nested stack only pays off if something else
   will consume the lessons. Until then `lesson.mjs` reading a committed data file
   is the smaller move.

Answer 1–3, write the ADR, then build. Do not start with the storage layer.

## Acceptance criteria

- [x] `node --test` green, including the existing token-leak assertions, plus new
      cases covering content selection and the `[TEST]` prefix. Ran 2026-08-25:
      42 pass, 0 fail.
- [x] `git diff --stat` for the notifier shows changes confined to
      `services/notifier/src/lesson.mjs` and its tests (a new `services/lesson/`
      and the root template are permitted if question 3 lands there). ADR 0009
      widened this to `handler.mjs` and a new `services/notifier/src/study/`
      module (`ddb.mjs`, `srs.mjs`, `curriculum.json`) plus `services/study/`
      (table only) — the ADR is the record of why, not a violation.
- [x] `sam validate --lint` and `sam build` clean, `sam build` still reporting both
      `NotifierProd/NotifierFunction` and `NotifierTest/NotifierFunction`. Ran
      2026-08-25: both clean.
- [x] A one-shot test schedule fires and a `[TEST]`-prefixed message with real
      content arrives on the phone. Confirmed by an arrival, not by reading code.
      One-shot `at(2026-08-25T21:11:00)` fired 21:11:36 VN (`docs/RUN-HISTORY.md`
      message 12), read the DynamoDB path (no `lesson.state.unavailable`
      fallback line), wrote `LESSON#2026-08-25#test` — the `#test`-suffixed key
      from ADR 0010, not the key a real submission would be graded against.
- [x] Two consecutive days produce different content (or the ADR states why
      repetition is acceptable). Covered by the test
      `two consecutive days do not produce the same lesson`
      (`services/notifier/test/*.test.mjs`), not by two real firings — only one
      calendar day has elapsed since this shipped, so production has not yet
      produced two different real days of content. Say so rather than ticking it
      as observed: the property is proven by test, not yet by a second sunrise.
- [x] An ADR in `docs/decisions/` records the answers to questions 1–3, with the
      rejected options. `docs/decisions/0009-lesson-content-source-state-and-the-async-seam.md`.

## Files likely touched

Landed differently from the guess, and ADR 0009 records why: `lesson.mjs`,
`handler.mjs`, `services/notifier/src/study/{ddb,srs}.mjs` +
`curriculum.json`, `services/study/template.yaml` (table only, no Lambda),
`docs/decisions/0009-*.md` and `0010-*.md` (not `0008`, which was already taken
by run-history), `.claude/rules/study-data.md`.

## Notes

`lesson.mjs` already receives `EnvironmentName`; that is the one piece of
environment awareness allowed inside the seam.

Closed 2026-08-25. A technical-concept extension to the same curriculum shipped
the same day as a separate, smaller unit of work — see backlog 0007.

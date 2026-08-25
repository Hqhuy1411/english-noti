# 0007 — Technical-concept content: MVCC, WAL, Bloom filter, gossip, index, SSTable

**State:** done
**Opened:** 2026-08-25 · **Closed:** 2026-08-25

## Goal

Extend the curriculum with the vocabulary of the learner's own field — databases,
distributed systems, performance/caching, search, data structures — so the daily
message eventually rotates through concepts the learner already understands but
cannot yet say fluently in English in a design review.

## Why this is a separate ticket, opened after the fact

This was not part of backlog 0001's scope, question 1–3, or acceptance criteria —
it is a new content request the project owner raised mid-session, after 0001 had
already shipped. It is recorded here, retroactively, so the board reflects what
was actually decided rather than only a commit message. Built and shipped in
commit `27eaff0` before this ticket existed; there was no gap between "decided"
and "done" to track.

## What shipped

- 33 items appended to `services/notifier/src/study/curriculum.json`
  (93 total, up from 60), tagged `tech`, each carrying a new `domain` field:
  `database`, `distributed-systems`, `performance`, `search`, or
  `data-structures` — all five covered, verified by
  `every technical domain the learner asked for is actually covered` in
  `services/notifier/test/curriculum.test.mjs`.
- A fourth speaking task type, `explain` (`services/notifier/src/lesson.mjs`):
  sixty seconds explaining the concept to a new teammate, used whenever the
  day's focus item is tagged `tech`. The other three task types (`shadow`,
  `answer`, `roleplay`) assume the learner does not yet know the word and needs
  to use it in a constructed sentence; a `tech` item is the opposite gap — the
  learner already knows what MVCC is, the gap is saying it out loud in English
  under work pressure, so reading a sentence aloud is the wrong exercise and
  `explain` replaces it rather than adding a fifth rotation slot.
- Every acronym is spelled out in `shadowSentence` ("write ahead log", not
  "WAL"). `curriculum.test.mjs` already banned acronyms there for the original
  content; it was kept rather than relaxed because it turned out to be exactly
  right for this content too — sounding out four ordinary words fluently is the
  actual difficulty, reading three letters aloud teaches nothing.
- `curriculum.test.mjs` extended to know the `tech` tag and to validate `domain`
  against its five allowed values, so a typo in a new item's `domain` fails the
  suite instead of silently not grouping.

## Evidence

`git show 27eaff0 --stat`; `node --test` → 42 pass, 0 fail; curriculum item
count confirmed at 93 with `python3 -c "import json; ..."` against
`services/notifier/src/study/curriculum.json`.

## Notes

No ADR was opened for this — it is additional data plus one task-selection
branch inside the seam ADR 0009 already defined (curated committed curriculum,
`lesson.mjs` chooses the task shape from item tags), not a new architectural
decision.

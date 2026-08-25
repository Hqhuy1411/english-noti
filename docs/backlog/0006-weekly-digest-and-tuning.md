# 0006 — Weekly digest and tuning

**State:** open
**Opened:** 2026-08-25 · **Closed:** —

## Goal

A `DigestFunction` fires Sunday 21:00 Asia/Ho_Chi_Minh with a weekly summary
(words mastered, active-use ratio — words actually spoken versus words studied,
the three most-repeated errors, and a three-question mock-interview set), and
the per-user split across work/daily/pronunciation content adjusts from stored
profile data without a redeploy.

## Why now

This is the closing phase of Phase 2 (`.claude/plans/phase-2-study-service.md`,
§1 "Weekly digest" and checklist Phase 2.5), and depends on 0001 (SRS/curriculum
data), 0004 (submission metrics) and 0005 (qualitative feedback) all already
writing data the digest can summarize. It also carries the plan's closing task
(5.4): a full audit of docs vs. code once Phase 2 is done, in the same spirit as
this STATUS/ADR audit.

## Constraints

- **ADR 0003 / ADR 0006** — a second schedule is a `ScheduleV2` cron
  (`cron(0 21 ? * SUN *)`, `Asia/Ho_Chi_Minh`), following the same pattern as
  the existing daily reminder; any tunable value (the work/daily/pronunciation
  split) is a stack Parameter or a `PROFILE` field, not a hardcoded constant,
  per ADR 0006's rule that anything you'd edit a file to test becomes testable
  without a deploy.
- **No LLM dependency for delivery** — carries over from 0005: if the digest's
  qualitative pieces (error summary, mock-interview questions) use the LLM seam,
  the digest must still send with a metrics-only fallback if that call fails.
- Reads `USER#<chatId>` items (`PROFILE`, `ITEM#`, `SUB#`) per the single-table
  schema from `.claude/plans/phase-2-study-service.md` §2.1 — do not introduce a
  second table or a GSI without an ADR, since the schema itself is already
  meant to be decided by an ADR opened in 0001/1.2 of the plan.

## Acceptance criteria

- [ ] `aws scheduler get-schedule` for the digest schedule confirms
      `cron(0 21 ? * SUN *)` and timezone `Asia/Ho_Chi_Minh`.
- [ ] A real Sunday firing (or a one-shot test firing, following the `/deploy`
      pattern used for the notifier) delivers a digest message to the phone.
- [ ] Changing the work/daily/pronunciation ratio for a test user is done by
      writing to `PROFILE` (a script or a direct `PutItem`), not by editing code
      or redeploying — verified by changing it and observing the next lesson's
      composition shift.
- [ ] `node --test` green for any new pure-function summarization logic (active-
      use ratio, top-3-error selection), with fixed sample data asserting exact
      output.
- [ ] The Phase 2 closing audit (plan checklist 5.4) is run: `docs/STATUS.md`,
      `CLAUDE.md`, and `.claude/rules/` are checked against the code as it
      stands after this ticket, and any drift or dead rule found is reported and
      fixed — the same kind of pass done for this ticket set.

## Files likely touched

`services/study/src/digest.mjs`, `services/study/template.yaml` (second
schedule), `docs/STATUS.md`, `CLAUDE.md`, `.claude/rules/`.

## Notes

Digest content and the tuning mechanism are described in
`.claude/plans/phase-2-study-service.md` section 1 ("Weekly digest") and section
2 (§2.1, `PROFILE` fields) — read those rather than re-deriving the shape here.

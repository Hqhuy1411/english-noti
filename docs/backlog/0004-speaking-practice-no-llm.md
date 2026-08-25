# 0004 — Speaking practice, no LLM involved

**State:** open
**Opened:** 2026-08-25 · **Closed:** —

## Goal

A voice note sent in reply to a lesson is transcribed and scored using only
locally-computed, deterministic metrics — no LLM call anywhere in this ticket.
The pipeline: Telegram voice note → S3 → Amazon Transcribe → an
EventBridge "Transcribe Job State Change" event → a grading function that
computes WPM, filler-word count, whether the day's target word(s) were used,
ASR confidence per word, and — for `shadow` tasks, where the target sentence is
already known — word-error-rate against that known sentence.

## Why now

Phase 2 (`.claude/plans/phase-2-study-service.md`, section 2, §2.3) treats
`shadow`-task WER as "the strongest signal in the whole system", precisely
because it needs no LLM judgment to compute. This ticket delivers that signal,
and the ack/transcript/metrics feedback loop, before any LLM cost or latency is
introduced (0005). It depends on 0003 (the reply channel) being in place —
this is Phase 2.3 in that plan's checklist.

## Constraints

- **ADR 0005** — a test-environment submission must stay unmistakable from a
  prod one; whatever record identifies a lesson (`LESSON#<date>` per the plan's
  §2.1 data model) must carry the environment.
- **The metrics must be pure functions, no I/O.** `.claude/plans/phase-2-study-service.md`
  §2.3 (task 3.3) calls this out explicitly because these numbers "must not
  hallucinate" — they need dense unit test coverage against fixed sample
  transcripts, not integration tests against a live Transcribe job.
- **Amazon Transcribe measures intelligibility, not phoneme accuracy.** Do not
  represent its output as pronunciation scoring. Keep a `assess.mjs` seam open
  for a future phoneme-scoring provider (Azure Speech Pronunciation Assessment,
  Speechace) — this ticket's own checklist item (3.6, plan §2.3) is to write
  the ADR stating this limit, not to build the future provider.
- **Transcribe job naming is the only context `GradeFunction` gets.** EventBridge
  hands the grading function nothing but the job name, so the name must encode
  everything needed to look the submission back up:
  `<env>-<chatId>-<YYYYMMDD>-<update_id>`. Uniqueness in-region comes from
  `<update_id>`.
- **ADR 0001** — no npm dependencies; use `@aws-sdk/client-transcribe` /
  `@aws-sdk/client-s3` lazily imported, matching the pattern already in
  `services/notifier/src/config.mjs` for `client-ssm`.
- **`AudioBucket` must block public access**, use SSE-S3, and expire objects
  after 30 days (plan §2.3) — audio is not retained indefinitely.
- Every new permission (S3 bucket scoped to `AudioBucket`,
  `transcribe:StartTranscriptionJob`, `events:PutRule`/`PutTargets`, and the
  read-back each of those needs for CloudFormation) goes into
  `docs/aws-permissions.json` before the first deploy attempt.

## Acceptance criteria

- [ ] `sam validate --lint` clean on `services/coach/template.yaml` with the
      audio/Transcribe resources added; hook passes.
- [ ] A voice note sent from the phone results in a Transcribe job visible in
      `aws transcribe list-transcription-jobs`, and a feedback message with a
      transcript arrives back in Telegram.
- [ ] `services/coach/src/metrics.mjs` has unit tests (`node --test`) covering
      WPM, filler count, target-word detection, and WER computation against at
      least one fixed sample transcript per task type (`shadow`, `answer`,
      `roleplay`), with expected numeric output asserted exactly.
- [ ] A word is promoted in the SRS box only when the submission is marked
      `spoken: true` — verified by a test that a submission without speech
      (or a failed job) leaves the box unchanged.
- [ ] Measured end-to-end latency (voice note sent → feedback received) is
      recorded in the ticket's Notes on close, not asserted in advance.
- [ ] An ADR documents the Transcribe intelligibility-vs-phoneme limitation and
      names the `assess.mjs` seam.

## Files likely touched

`services/coach/template.yaml` (AudioBucket, TranscribeDoneRule, IAM),
`services/coach/src/handler.mjs` (voice branch), `services/coach/src/metrics.mjs`,
`services/coach/src/grade.mjs`, `docs/aws-permissions.json`, a new ADR in
`docs/decisions/`.

## Notes

Full design — S3 key layout, the EventBridge rule's `source`/`detail-type`
filter, and the grading function's read-back of `LESSON#<date>` — is in
`.claude/plans/phase-2-study-service.md` section 2 (§2.3). Read it rather than
re-deriving it; this ticket links to it instead of restating it.

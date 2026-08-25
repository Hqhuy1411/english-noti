# 0005 — LLM coaching

**State:** open
**Opened:** 2026-08-25 · **Closed:** —

## Goal

Qualitative feedback — task-achievement and register judgment for `roleplay` and
`writing` submissions, and "say it like this instead" rewrites — comes from an
LLM behind a single seam, `llm.mjs`, with prompt caching on a stable prefix and
a provider/model decision recorded in an ADR. Message delivery (both the daily
lesson and submission feedback) never depends on the LLM call succeeding.

## Why now

0004 delivers deterministic metrics with no LLM involved; this ticket adds the
judgment those metrics can't produce (is this a natural thing to say in a
standup, not just whether the target word appeared). It is Phase 2.4 in
`.claude/plans/phase-2-study-service.md`'s checklist, and depends on 0003 (reply
channel) and 0004 (transcript + metrics) being in place.

## Constraints

- **Delivery must never depend on an LLM call — this is the one invariant this
  ticket must not compromise.** `buildLesson()` and the grading path both need a
  deterministic fallback (`data/curriculum.json` for the lesson; metrics-only
  feedback with no qualitative rewrite for a submission) when the LLM errors,
  times out, or the key is wrong. Phase 1 paid for the delivery guarantee
  already (ADR 0003's punctuality, `docs/DEPLOY-LOG.md`'s permission rounds);
  this ticket must not spend it.
- **Provider/model choice is unresolved and must be settled by an ADR, not
  assumed.** `.claude/plans/phase-2-study-service.md` section 3 lays out the
  cost comparison (all candidate models are under $1/month at this volume, so
  cost is not the deciding factor — judgment quality for job (b)/(c) is) and an
  open risk: it is **not documented** which AWS SDK v3 clients ship in the
  `nodejs22.x` managed runtime, so whether `@aws-sdk/client-bedrock-runtime` is
  available must be **probed with a real deployed Lambda that imports it and
  prints the resolved version** before committing to Bedrock — not assumed. If
  it isn't present, Bedrock forces packaging a dependency, which reopens
  **ADR 0001** (zero npm dependencies) explicitly. Calling a provider's HTTP API
  directly with `fetch` (e.g. Anthropic's API) avoids that risk entirely.
- **Batch inference is rejected up front** (plan §3): it cuts cost ~50% but adds
  unpredictable latency to a path a person is waiting on. Don't re-propose it
  without new evidence.
- **Prompt caching requires a stable prefix** — no timestamp or per-request id
  in the cached portion of the prompt, or the cache never hits.
- No secret (API key, or none if IAM-only via Bedrock) in a template, env var,
  or log line — SSM SecureString, same pattern as ADR 0004.

## Acceptance criteria

- [ ] A probe Lambda import of `@aws-sdk/client-bedrock-runtime` (if Bedrock is
      the candidate) is deployed and invoked once; its printed result — present
      or absent, with version if present — is recorded in the ADR as evidence,
      not asserted from documentation alone.
- [ ] An ADR names the chosen provider and the model per job (daily-lesson
      generation, speaking-grading, writing-grading), with a cited price source
      for each, states the probe result, and states the delivery-never-depends-
      on-LLM rule explicitly.
- [ ] `services/*/src/llm.mjs` exposes one call interface; swapping model or
      provider is a change to one constant, verified by `git diff --stat`
      touching only that constant plus the ADR.
- [ ] A test that forces the LLM call to fail (bad key, or a stub that throws)
      still results in a delivered lesson message and a delivered submission
      feedback message — `node --test` asserts this, it is not just observed
      once by hand.
- [ ] A real submission produces an LLM-backed rewrite/feedback message,
      confirmed by arrival on the phone.
- [ ] `node --test` still green, including existing token-leak assertions —
      the LLM key must not appear in any log line either.

## Files likely touched

`services/coach/src/llm.mjs`, `services/notifier/src/lesson.mjs` (if generation
also becomes LLM-backed per the plan's job (a)), `docs/aws-permissions.json`
(if Bedrock — `bedrock:InvokeModel`), a new ADR in `docs/decisions/`.

## Notes

Cost analysis, model shortlist with citations, and the per-job routing
recommendation are worked out already in
`.claude/plans/phase-2-study-service.md` section 3 — read it before re-pricing
anything. Do not hardcode the ADR number guessed in that plan's section 4; take
the actual next free number from `docs/STATUS.md` when this ticket is picked up.

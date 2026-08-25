# 0003 — Inbound reply channel: Telegram webhook

**State:** open
**Opened:** 2026-08-25 · **Closed:** —

## Goal

The bot can receive something back — a button press, a text reply, or a voice
note — instead of only ever sending. A new `services/coach/` nested stack exposes
one `POST /telegram` route behind an `AWS::Serverless::HttpApi`, registered with
Telegram via `setWebhook`, that authenticates the caller, rejects anything that
isn't Telegram or isn't the allowed chat, de-duplicates retried updates, and acks
fast enough that Telegram doesn't retry a request that already succeeded.

This ticket is the channel only: routing, auth, idempotency, and the inline
keyboard on the outbound side. It does not include audio handling (0004) or any
LLM-generated response (0005) — a plain-text ack is sufficient to close this
ticket.

## Why now

Phase 2 (`.claude/plans/phase-2-study-service.md`, section 2, §2.3) needs a
reply channel before speaking practice (0004) or coaching (0005) can exist —
both depend on receiving a Telegram update. This is Phase 2.2 in that plan's
checklist.

## Constraints

- **New ADR needed** for the webhook auth design (secret-token + chat allowlist,
  and specifically why a rejected update still returns `200`). Do not build this
  silently — write the ADR first. Next free ADR number per `docs/STATUS.md` at
  the time this ticket is picked up; do not hardcode a number guessed from the
  plan file, per that file's own note in section 4.
- **ADR 0002** — this is a new nested stack (`services/coach/`), following the
  same `AWS::Serverless::Application` shape as `services/notifier/`.
- **ADR 0001** — no npm dependencies. The webhook handler and its Telegram client
  use `fetch` and Node 22 built-ins only.
- **No secret in a template, an env var, or a log line** (`CLAUDE.md`
  invariants). The webhook `secret_token` is an SSM SecureString, created out of
  band the same way as the bot token (ADR 0004) — not owned by the stack.
- Telegram **retries an update** if it doesn't receive a `200` quickly. Rejecting
  a bad update must still return `200` (logged as rejected), or Telegram will
  hammer the endpoint. This is the reason the ADR above exists.
- Every new AWS action (`apigateway:*` create and **read-back**, per the
  `scheduler:CreateSchedule`-without-`GetSchedule` trap in `docs/DEPLOY-LOG.md`)
  must be added to `docs/aws-permissions.json` before deploying, not discovered
  by iterating rollbacks.

## Acceptance criteria

- [ ] `sam validate --lint --region ap-southeast-1` clean; the hook in
      `.claude/hooks/validate-template.sh` passes on `services/coach/template.yaml`.
- [ ] `sam build` lists a coach function alongside both notifier functions.
- [ ] A request with a wrong or missing `secret_token` header returns `200` and
      logs a single JSON line identifying it as rejected — verified with `curl`
      against the deployed endpoint, not by reading the code.
- [ ] A request from a chat id outside the allowlist is rejected the same way.
- [ ] The same `update_id` sent twice is processed once — the second request logs
      a duplicate and performs no action. Verified by sending the identical
      payload twice.
- [ ] A real button press and a real text reply from the phone reach the
      function and produce a log line — confirmed by an actual Telegram
      interaction, not a synthetic payload alone.
- [ ] `services/coach/scripts/set-webhook.mjs` registers the webhook using only
      the Telegram API (no AWS credentials), takes the API URL as an argument,
      and `getWebhookInfo` confirms registration afterward.
- [ ] `node --test` still green, including existing token-leak assertions.

## Files likely touched

`services/coach/template.yaml`, `services/coach/src/handler.mjs`,
`services/coach/src/telegram.mjs`, `services/coach/scripts/set-webhook.mjs`,
root `template.yaml`, `docs/aws-permissions.json`, a new ADR in
`docs/decisions/`, `.claude/skills/telegram-bot-ops/`.

## Notes

`.claude/plans/phase-2-study-service.md` section 2 (§2.3) has the full design:
route table, the `IngestFunction` responsibilities for text vs. voice vs.
`callback_query`, and the `update_id` conditional-write pattern
(`attribute_not_exists(PK)` on `UPDATE#<update_id>` with a 24h TTL). Read it
before designing this from scratch — do not restate it here, it will drift from
the plan.

Voice-note handling (S3 upload, Transcribe) is explicitly out of scope for this
ticket — see 0004.

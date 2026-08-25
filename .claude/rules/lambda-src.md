---
paths:
  - "services/*/src/**/*.mjs"
---

# Lambda source conventions

Loaded when editing runtime code. Reasoning and rejected alternatives live in
`docs/decisions/`.

## Dependencies: zero, deliberately

The Lambda has **no npm dependencies** and no `package.json`. Node 22 built-ins
cover everything: `fetch` for HTTP, `Intl` for timezone formatting,
`process.loadEnvFile()` for local `.env`. The AWS SDK v3 ships inside the
`nodejs22.x` runtime and is imported **lazily** (`await import(...)`) so local
scripts run with no `node_modules` at all.

Before adding any dependency, check whether a Node built-in does it. The payoff is
a few-KB deploy package and ~200 ms cold start. See `docs/decisions/0001`.

## Secrets

- The bot token lives in **SSM Parameter Store as a SecureString** at
  `/english-reminder/telegram-bot-token`, created out-of-band by the user. It is
  not owned by the stack; see `docs/decisions/0004`.
- A secret must never reach a CloudFormation template, a Lambda environment
  variable, or a log line. `TELEGRAM_CHAT_ID` is not a secret and *is* an env var.
- The Telegram token sits in the **request URL**, so errors in `telegram.mjs` are
  built from the method name only — never from the URL, or the token leaks into
  every stack trace. `test/notifier.test.mjs` asserts the token appears in neither
  the error message, the stack, nor any log line. Keep those passing.
- Local development reads `.env` (gitignored, mode 600). Never commit it.

## Logging

One JSON object per line to stdout (stderr for `ERROR`), always carrying `level`,
`event`, `ts`. CloudWatch parses that into queryable fields — no parsing config
needed. Event names are namespaced with a dot: `invocation.start`, `send.success`,
`send.failure`.

`scheduledTime` comes from the EventBridge Scheduler event and is `null` on a
manual `lambda invoke` — that is how you tell a real scheduled reminder from a
hand-triggered one when auditing.

A failed send logs Telegram's own `description`, `errorCode` and `httpStatus`, so a
rejection explains itself without a redeploy. Then it **rethrows** — that is what
marks the invocation errored on the `Errors` metric and lets the scheduler retry.
Do not swallow errors to make a run look clean.

## Phase 2 seam

`lesson.mjs` is where lesson content is built, and the seam is kept deliberately
narrow: scheduling, delivery and logging stay untouched. See
**`docs/decisions/0009`**, which supersedes 0007.

0007 said `lesson.mjs` was the *only* file Phase 2 would touch. That did not
survive: content is async, so `handler.mjs` awaits `buildLesson()` (an import
rename plus a two-line call site), and `telegram.mjs` gains an optional
`replyMarkup` parameter when ticket 0003 has something to receive a button press.
Both were amended in the open through 0009 rather than widened quietly -- which is
what 0007 asked for. Anything further reaching outside `lesson.mjs` deserves the
same treatment.

## Code style

ESM `.mjs` throughout. Comments are in English, explain *why* rather than what, and
sit at the top of a module to say what it is for. Vietnamese belongs in
user-facing message text, not in code comments.

Anything you edit here is covered by `node --test` from the project root. Run it.

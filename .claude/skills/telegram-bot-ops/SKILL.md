---
name: telegram-bot-ops
description: Diagnose a Telegram Bot API problem for this project — a bot that appears broken, a chat that will not resolve, getUpdates returning nothing, a rejected sendMessage, or a token that needs rotating. Use when a message does not arrive, when looking up a TELEGRAM_CHAT_ID, when getUpdates is empty, when the Bot API returns an error code, or before assuming an AWS problem is at fault.
---

# Telegram Bot API, as it actually behaves

Most "the bot is broken" reports here are one of the facts below, not a bug in the
code and not an AWS problem. Check these before touching AWS.

## A bot cannot open a conversation

A Telegram bot **cannot** message someone who has never messaged it first, and a
chat does not appear in `getUpdates` until that chat has written to the bot. This
is the usual cause of a new bot appearing broken: the token is fine, the code is
fine, and there is simply no chat to send to.

Fix: open the bot in Telegram and send it anything, once. Then look up the chat id.

## `getUpdates` is safe to poll

`getUpdates` **without** an `offset` does not consume updates, so polling it is
safe and repeatable. You can run `scripts/get-chat-id.mjs` as many times as you
like without destroying state. Passing an `offset` *does* acknowledge and drop
earlier updates — so do not add one just to tidy the output.

## The token is in the URL

The Bot API puts the token in the request path
(`https://api.telegram.org/bot<TOKEN>/sendMessage`). Two consequences:

- Never build an error from the URL or from a `fetch` error's default message, or
  the token lands in every stack trace and every log line. `src/telegram.mjs`
  builds errors from the **method name** only, and `test/notifier.test.mjs` asserts
  this. Keep it that way.
- Never paste a raw API URL into a chat, a transcript, an issue, or a commit
  message. `.claude/settings.json` denies `Read(./.env)` and
  `aws ssm get-parameter` for exactly this reason.

## Isolating a failure

`services/notifier/scripts/send-now.mjs` needs no AWS credentials at all. It is the
gate:

- Message arrives from your machine → Telegram side is healthy; the problem is
  AWS (the SSM parameter, the role, the schedule).
- Message does not arrive → the problem is the token or the chat id. Stop; do not
  debug AWS.

## Reading a rejection

A failed send logs Telegram's own `description` alongside `errorCode` and
`httpStatus`, so the rejection explains itself without a redeploy. Common ones:

| Code | `description` says | Real cause |
|---|---|---|
| 401 | `Unauthorized` | Token wrong, or revoked via `@BotFather` and not yet updated in SSM |
| 400 | `chat not found` | Wrong chat id, or the chat never messaged the bot |
| 403 | `bot was blocked by the user` | The user blocked it; nothing to fix in code |
| 429 | `Too Many Requests` | Rate limited; `retry_after` is in the payload |

## Rotating the token

`@BotFather` → `/revoke` → pick the bot → copy the new token. Then update `.env`
**and** the SSM parameter with `--overwrite`. No redeploy is needed: the function
reads the parameter at runtime. Full procedure in `docs/RUNBOOK.md` §8.

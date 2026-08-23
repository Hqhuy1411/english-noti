---
paths:
  - "services/*/test/**"
  - "services/*/scripts/**"
---

# Tests and local scripts

## Running the suite

`node --test` from the project root (`english-reminder/`). The Node built-in
runner, no dependency, with `fetch` stubbed — the suite touches no network and no
AWS.

The bare directory form (`node --test path/to/test/`) **fails**. Use plain
`node --test`, or a glob.

Tests live in `services/notifier/test/`, deliberately outside `src/`, which is what
`CodeUri` points at — so they never ship in the deploy package. Do not move a test
under `src/` to make an import shorter.

## The token-leak assertions are load-bearing

`test/notifier.test.mjs` asserts the bot token appears in neither an error
message, nor a stack trace, nor any log line. The Telegram token sits in the
request URL, so an error built from the URL leaks it into every stack trace. If one
of those assertions goes red, treat it as a security regression, not a flaky test.

## Verify locally before touching AWS

`services/notifier/scripts/` talks only to Telegram and needs **no AWS
credentials**. `send-now.mjs` is the gate: if the message does not arrive from your
own machine, the problem is the token or the chat id, not AWS.

Keep that property — a script in here must never require AWS. The moment one does,
the gate stops being able to isolate a Telegram problem from an AWS problem.

For the Telegram Bot API's own non-obvious behaviour (a bot cannot message someone
first; `getUpdates` and `offset`), see the `telegram-bot-ops` skill.

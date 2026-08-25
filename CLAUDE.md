# english-reminder

Serverless reminder system. Phase 1 (done, deployed): a Lambda fires at 21:00
Asia/Ho_Chi_Minh and sends a Telegram message. Phase 2: real English-learning
content behind the `lesson.mjs` seam.

**Read `docs/STATUS.md` before starting any work.** It says what is live, what is
open, and what has already been decided. It exists so you never have to ask the
user something they have already answered.

Run every command from this directory (`english-reminder/`), not from `tools/`.

## Where things are

Almost nothing is in this file on purpose — it loads into every session, so it
holds only what is true everywhere. Everything else loads when it is relevant.

| Question | Where |
|---|---|
| What is live, what is open, what is next | `docs/STATUS.md` |
| **Why** is it built this way, and what was rejected | `docs/decisions/` (index: its `README.md`) |
| Work items, with acceptance criteria | `docs/backlog/` |
| Build, deploy, verify, operate, tear down | `docs/RUNBOOK.md` |
| What was actually deployed, and what blocked it | `docs/DEPLOY-LOG.md` |
| Did it actually fire, on which nights, and did it send | `docs/RUN-HISTORY.md` |
| Least-privilege deploy permissions | `docs/aws-permissions.json` |
| Permissions needed to *see the bill* (deploy user cannot) | `docs/aws-billing-permissions.json` |
| Rules for templates / runtime code / tests | `.claude/rules/` — path-scoped, load themselves |
| A deploy rolled back, or a permission is suspect | `cfn-deploy-triage` skill |
| A Telegram message did not arrive | `telegram-bot-ops` skill |

Read the pointer, not a reconstruction. The permission discovery alone took six
deploy rounds; it is written down.

## Where new knowledge goes

When something is learned or decided, route it — do not leave it in the
conversation, where the next session cannot see it.

| Kind of thing | Goes to | Committed? |
|---|---|---|
| A decision, and the alternative rejected | `docs/decisions/NNNN-*.md` | yes |
| A rule for one area of the code | `.claude/rules/` (add `paths:`) | yes |
| A multi-step procedure | `.claude/skills/` | yes |
| Work to be done, or its state | `docs/backlog/` + `docs/STATUS.md` | yes |
| An invariant true everywhere | this file | yes |
| The user's personal preferences | auto memory | no — machine-local |

Auto memory is **not** a source of truth here: it does not sync between machines,
subagents cannot read it, and a teammate never sees it. Anything a second person
would need must be committed.

## Invariants

These hold everywhere, so they are here rather than in a rule that might not load.

- **No secret in a template, a Lambda environment variable, or a log line.** The
  bot token is an SSM SecureString read at runtime (ADR 0004). `TELEGRAM_CHAT_ID`
  is not a secret and *is* an env var. `.env` is gitignored, mode 600 — never
  commit it, never print it.
- Region `ap-southeast-1`, architecture `arm64`, runtime `nodejs22.x`.
- No npm dependencies (ADR 0001). Check for a Node 22 built-in first.
- Conventions here are decisions already paid for. If one looks wrong, read its
  ADR and **say so** — do not work around it silently.

## Tooling in `.claude/`

| Path | What it does |
|---|---|
| `commands/deploy.md` | `/deploy` — validates, builds, resolves a future-dated one-shot for the test schedule, deploys, then reports the schedules as they actually ended up. |
| `commands/status.md` | `/status` — read-only health check: next fire times, last run and its outcome, and whether a run was scheduled or hand-triggered. Never invokes a function. |
| `rules/` | Path-scoped conventions: `infra-templates.md` (templates), `lambda-src.md` (runtime code), `tests-and-scripts.md` (tests, local scripts). They enter context when you open a matching file. |
| `skills/cfn-deploy-triage/` | Rolled-back deploy: read the *nested* stack's events, and avoid the two permission traps that cost five deploys here. |
| `skills/telegram-bot-ops/` | Bot API behaviour that makes a working bot look broken. |
| `agents/convention-keeper.md` | Subagent that maintains this file, the ADR index and `docs/STATUS.md`. |
| `hooks/validate-template.sh` | `PostToolUse` on Write/Edit: runs `sam validate --lint` on any edited `template.yaml` and feeds the error back. |
| `settings.json` | Wires the hook. Allows read-only AWS verification without prompting; **denies** `Read(./.env)` and `aws ssm get-parameter`, so the token cannot be printed into a transcript by accident. Committed — it is the team's. `settings.local.json` is personal and gitignored. |

A newly added `.claude/settings.json` is not picked up mid-session — the settings
watcher only watches directories that already had a settings file at startup. Open
`/hooks` once, or restart, to load it.

## Don't claim it works until it ran

State what was actually executed and what its output was. "Should work" is not a
result. `node --test`, `sam validate --lint` and `sam build` are all cheap — run
them and quote what they printed.

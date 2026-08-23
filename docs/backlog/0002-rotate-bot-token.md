# 0002 — Rotate the bot token exposed in a setup transcript

**State:** open
**Opened:** 2026-08-23 · **Closed:** —

## Goal

The current Telegram bot token is revoked and replaced, in both `.env` and the SSM
SecureString parameter, and the reminder keeps working across the swap.

## Why now

`docs/DEPLOY-LOG.md` ("Security follow-up") records that the token was pasted into
a chat transcript during setup. A bot token is a bearer credential granting full
control of the bot — anyone holding it can read messages sent to the bot and send
messages as it. This is now tracked instead of living as a paragraph at the bottom
of a log file, and it should be closed **before the repo is shared with anyone**.

The repo has just been given a remote (`github.com:Hqhuy1411/english-noti`). The
token itself was never committed — `.gitignore` covers `.env`, verified with
`git check-ignore` — so this is about the transcript exposure, not a git leak.

## Constraints

- **ADR 0004** — the token is an SSM SecureString created out-of-band. Rotation is
  `put-parameter --overwrite`, **not** a stack change.
- **No redeploy is needed.** The function reads the parameter at runtime. If a
  redeploy seems necessary, something else is wrong.
- The new token must not appear in a transcript, a commit message, a log line, or
  a ticket. `.claude/settings.json` denies `Read(./.env)` and
  `aws ssm get-parameter` for this reason — do not work around those denials.
- Procedure is written already: `docs/RUNBOOK.md` §8. Follow it rather than
  reconstructing it.

## Acceptance criteria

- [ ] `@BotFather` → `/revoke` completed; the old token returns `401 Unauthorized`
      from the Bot API.
- [ ] `.env` updated, still mode 600, still untracked (`git check-ignore -v .env`
      returns a match).
- [ ] SSM parameter updated with `--overwrite`, still `SecureString`, still
      `alias/aws/ssm`.
- [ ] `node services/notifier/scripts/send-now.mjs` delivers a message — proves the
      new token works locally, with no AWS involved.
- [ ] A prod or test firing delivers a message **without a redeploy** — proves the
      function picked up the new value at runtime.
- [ ] `docs/DEPLOY-LOG.md` "Security follow-up" updated to say it was done, with
      the date. No token in the text.

## Files likely touched

`.env` (untracked), `docs/DEPLOY-LOG.md`, `docs/STATUS.md`. No source, no template.

## Notes

The user does this by hand: revoking needs Telegram, and the token must not pass
through an agent transcript.

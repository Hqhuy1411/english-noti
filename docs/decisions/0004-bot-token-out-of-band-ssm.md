# 0004 — The bot token lives in SSM as a SecureString, created by hand

**Status:** accepted · **Date:** 2026-08 · **Applies to:** the whole project

## Context

The Telegram bot token is a bearer credential that grants full control of the bot.
The convention for this project is that a secret never reaches a CloudFormation
template, a Lambda environment variable, or a log line.

## Decision

The token lives in **SSM Parameter Store as a `SecureString`** at
`/english-reminder/telegram-bot-token`, encrypted with the default `alias/aws/ssm`
key. It is created **out-of-band, by hand**, and is **not owned by the stack**. The
function reads it at runtime via `ssm:GetParameter`, granted through the SAM policy
template `SSMParameterWithSlashPrefixReadPolicy` scoped to `/english-reminder/*`.

## Rejected alternatives

- **`AWS::SSM::Parameter` in the template** — **impossible**, not merely
  discouraged: that resource type supports `String` and `StringList` only, never
  `SecureString`. This is the reason the parameter is created by hand. It is a
  constraint, not an oversight; **do not "fix" it** by moving the token into the
  template.
- **A Lambda environment variable** — visible in the console, in
  `get-function-configuration`, and to anyone with read access to the function.
- **Secrets Manager** — would work, but costs per secret per month and adds
  rotation machinery this project does not use. SSM SecureString is free at this
  scale.
- **A template Parameter with `NoEcho`** — still lands in the change set and in
  deploy history.

## Consequences

- **Deleting the stack does not delete the token.** Teardown must remove it
  separately; `docs/RUNBOOK.md` §10 says so explicitly.
- The stack is not fully reproducible from source alone: a fresh deploy needs the
  parameter to exist first. Documented as step 5 in `docs/RUNBOOK.md`.
- No explicit `kms:Decrypt` statement is needed, because the default
  `alias/aws/ssm` key's own policy grants the account access via `kms:ViaService`.
  Confirmed by a real invocation. If a KMS `AccessDeniedException` ever appears, a
  non-default key is in play — add the statement then.
- Rotation is `@BotFather` → `/revoke`, then `.env` **and** `put-parameter
  --overwrite`. **No redeploy needed** — the function reads at runtime.

## Evidence

`docs/DEPLOY-LOG.md` "What is deployed right now" and its Security follow-up;
`docs/RUNBOOK.md` §5 and §8.

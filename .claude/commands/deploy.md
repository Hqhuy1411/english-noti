---
description: Deploy english-reminder, with the one-shot test schedule armed correctly
argument-hint: "[test-time, e.g. 'in 5m' or '2026-08-25T09:00:00']"
---

Deploy this stack. Run from the project root.

## Before deploying

1. `node --test` — if the suite is red, stop and report. Do not deploy over failing tests.
2. `sam validate --lint --region ap-southeast-1`
3. `sam build` — confirm it reports **both** environments:
   `functions: NotifierProd/NotifierFunction, NotifierTest/NotifierFunction`
   If only one appears, the root template lost a nested application block.

## Arming the test schedule

`TestScheduleExpression` has no default on purpose. A one-shot `at(...)` already
in the past **never fires and reports nothing**, so it must be computed fresh.

The user asked for: `$ARGUMENTS`

Resolve that to a concrete Vietnam-local timestamp. Get the current time first —
never assume it from earlier in the conversation, which may be hours stale:

```
TZ=Asia/Ho_Chi_Minh date '+%Y-%m-%dT%H:%M:%S'
```

- A relative ask ("in 5 minutes") → `TZ=Asia/Ho_Chi_Minh date -v+5M '+%Y-%m-%dT%H:%M:00'`
- An absolute time already in the past → say so and propose the next occurrence.
  Do not silently deploy a dead schedule.
- Nothing given → default to 8 minutes out, which clears the deploy itself.

## Deploy

```
sam deploy --no-confirm-changeset --parameter-overrides \
  TelegramChatId=<from .env> \
  TestScheduleExpression='at(<resolved>)' \
  TestScheduleState=ENABLED
```

**Pass `TestScheduleState=ENABLED` every time, even though `ENABLED` is the
template default.** The test environment was parked on 2026-08-24 (ADR 0008,
`docs/STATUS.md`), so the *stack's* stored value is `DISABLED`. A parameter you
omit is not reset to its default — CloudFormation reuses the previous value. Omit
it and the deploy succeeds, reports a perfectly good `at(...)` expression, and the
smoke test silently never fires: the same failure mode as a past `at(...)`, from a
different direction.

To park it again after testing, deploy with `TestScheduleState=DISABLED`.

Read `TELEGRAM_CHAT_ID` from `.env`; do not hardcode it. Never pass the bot
token — it lives in SSM and is read at runtime.

## After deploying

Report the actual outcome, not an expectation:

```
aws scheduler get-schedule --name english-reminder-prod --group-name default --region ap-southeast-1 \
  --query '{Expr:ScheduleExpression,TZ:ScheduleExpressionTimezone,State:State}'
aws scheduler get-schedule --name english-reminder-test --group-name default --region ap-southeast-1 \
  --query '{Expr:ScheduleExpression,TZ:ScheduleExpressionTimezone,State:State}'
```

Then state plainly when each will next fire in Vietnam time, and that prod
remains `cron(0 21 * * ? *)` unless it was deliberately overridden.

If the deploy rolls back, do not re-run it blindly — use the `cfn-deploy-triage`
skill, which reads the nested stack's own events instead of the root's summary.

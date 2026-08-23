---
description: Health check the deployed reminder — schedules, last run, and whether it actually sent
argument-hint: "[prod|test|both]"
---

Read-only operational check of the deployed system. Change nothing.

Target: `$ARGUMENTS` (default: both).

## Gather

Current Vietnam time first, so every timestamp below can be judged against it:

```
TZ=Asia/Ho_Chi_Minh date '+%Y-%m-%dT%H:%M:%S'
```

Stack and outputs:

```
aws cloudformation describe-stacks --stack-name english-reminder --region ap-southeast-1 \
  --query 'Stacks[0].{Status:StackStatus,Updated:LastUpdatedTime}'
```

For each environment in scope:

```
aws scheduler get-schedule --name english-reminder-<env> --group-name default --region ap-southeast-1 \
  --query '{Expr:ScheduleExpression,TZ:ScheduleExpressionTimezone,State:State}'

aws logs tail /aws/lambda/english-reminder-notifier-<env> --since 48h --format short --region ap-southeast-1
```

## Interpret

Report, per environment:

- **Next fire time** in Vietnam local time. For prod, the next 21:00. For test,
  whether its `at(...)` is still in the future — a past `at(...)` on an `ENABLED`
  schedule is **finished work, not pending**; say so rather than implying it will run.
- **Last run and its outcome**, from the log lines. `send.success` carries
  `messageId` and `durationMs`; `send.failure` carries Telegram's own
  `description`, `errorCode` and `httpStatus` — quote those, they explain the
  failure without further digging.
- **Scheduled versus manual.** `scheduledTime` is non-null only when EventBridge
  Scheduler invoked it. A run with `scheduledTime: null` was a hand-triggered
  `lambda invoke` and is not evidence the schedule works.
- **A silent gap.** No log entry near a time prod should have fired is itself the
  finding — report it rather than reporting "no failures".

Do not invoke either function to "check" it: that sends a real Telegram message
and writes a manual entry into the log you are auditing.

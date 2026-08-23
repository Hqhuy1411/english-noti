# English Reminder

Sends a Telegram message every day at **21:00 Asia/Ho_Chi_Minh** to remind me to
study English.

## How it works

```
AWS::Scheduler::Schedule            Lambda (nodejs22.x, arm64, no deps)
cron(0 21 * * ? *)                  ┌──────────────────────────┐
TZ Asia/Ho_Chi_Minh  ─── invoke ──▶ │ handler.mjs              │ ──HTTPS──▶ Telegram
                                    │  ├─ lesson.mjs  content  │            Bot API
                                    │  ├─ telegram.mjs send    │
                                    │  └─ logger.mjs  JSON log │
                                    └────┬────────────────┬────┘
                    ssm:GetParameter     │                │ stdout
                                         ▼                ▼
                         SSM SecureString         CloudWatch Logs
                         bot token                30-day retention
```

Two environments come out of the same service template: **prod** fires at 21:00
every day, **test** is a one-shot you aim at a specific moment to prove a change
end-to-end without waiting for, or disturbing, the real reminder. A test message
is labelled `[TEST]` so the two can never be confused.

EventBridge Scheduler rather than a GitHub Actions cron, because the schedule
has to be punctual: Actions cron routinely runs 5–30 minutes late and can skip a
run entirely under load. Scheduler was measured here at ~36 s from the scheduled
moment to handler start, and understands `Asia/Ho_Chi_Minh` natively, so there is
no UTC arithmetic to get wrong.

Running cost is effectively zero -- ~30 invocations a month sits far inside the
Lambda and Scheduler free tiers. CloudWatch Logs is the only real line item,
which is why retention is capped.

## Layout

| Path | What it is |
|---|---|
| `template.yaml` | Root CloudFormation stack. One `AWS::Serverless::Application` per service, which expands into a nested stack. |
| `services/notifier/template.yaml` | SAM template: function, schedule, log group, IAM. |
| `services/notifier/src/` | Lambda source. `lesson.mjs` is the seam where Phase 2 plugs in real lesson content. |
| `services/notifier/scripts/` | Local helpers -- talk to Telegram only, no AWS needed. |
| `samconfig.toml` | Stack name, region, and the capabilities nested stacks require. |

## First-time setup

**1. Create the bot.** Message [@BotFather](https://t.me/BotFather) → `/newbot`
→ copy the token.

**2. Message your own bot.** Send it anything. This is mandatory: Telegram will
not reveal a chat through `getUpdates` until that chat has written to the bot,
and a bot can never open a conversation first.

**3. Configure locally.**

```sh
cp .env.example .env          # then paste the token into TELEGRAM_BOT_TOKEN
node services/notifier/scripts/get-chat-id.mjs   # prints TELEGRAM_CHAT_ID=...
```

Add the printed chat id to `.env`.

**4. Prove it works before touching AWS.**

```sh
node services/notifier/scripts/send-now.mjs
```

The message should land on your phone. If this fails, the problem is the token
or the chat id -- not AWS.

**5. Store the token in AWS.** The token never goes into a template, a Lambda
environment variable, or a log:

```sh
aws ssm put-parameter \
  --name /english-reminder/telegram-bot-token \
  --type SecureString --value 'PASTE_TOKEN' \
  --region ap-southeast-1
```

**6. Grant the deploying user its permissions.** A default developer IAM user is
usually missing the S3 and SSM access SAM needs. `docs/aws-permissions.json` is
the least-privilege set; `docs/RUNBOOK.md` §4 explains each block and how to
attach it.

**7. Deploy.**

```sh
brew install aws-sam-cli        # once
aws login                       # once, if credentials are not configured
sam validate --lint
sam build
sam deploy --parameter-overrides \
  TelegramChatId=<your-chat-id> \
  TestScheduleExpression='at(2026-08-24T09:00:00)'
```

`TestScheduleExpression` has no default deliberately: a one-shot `at(...)` in the
past silently never fires, so pick it consciously each deploy.

**Full command reference, including operating and teardown: `docs/RUNBOOK.md`.**

## Tests

```sh
node --test
```

The Node built-in runner with `fetch` stubbed -- no dependency, no network, no
AWS credentials. Covers the timezone rendering, the Telegram request shape, the
log lines each outcome emits, and that the bot token never reaches an error
message, a stack trace, or a log.

## Everyday commands

Invoke on demand (`test` is safe to invoke freely):

```sh
aws lambda invoke --function-name english-reminder-notifier-test \
  /dev/stdout --region ap-southeast-1
```

Tail the logs:

```sh
aws logs tail /aws/lambda/english-reminder-notifier-test \
  --since 30m --format short --region ap-southeast-1
```

See the nested stack CloudFormation actually built. The SAM macro expands
`AWS::Serverless::Application` into `AWS::CloudFormation::Stack` server-side at
deploy time, so this -- not `sam build` output -- is where the expansion shows up:

```sh
aws cloudformation get-template --stack-name english-reminder \
  --template-stage Processed --region ap-southeast-1
```

Check the schedule is what you think it is:

```sh
aws scheduler get-schedule --name english-reminder-prod \
  --group-name default --region ap-southeast-1
```

Re-arm the one-shot test for a new moment -- a stack parameter, so no file edit:

```sh
sam deploy --no-confirm-changeset --parameter-overrides \
  TelegramChatId=<id> TestScheduleExpression='at(2026-08-25T09:00:00)'
```

## Reading the logs

Every run emits one-line JSON, which CloudWatch parses into queryable fields.
`invocation.start` always appears, followed by exactly one of `send.success` or
`send.failure`. In Logs Insights:

```
fields @timestamp, event, level, messageId, durationMs, description
| filter event like /send/
| sort @timestamp desc
```

A failure carries Telegram's own `description` alongside `errorCode` and
`httpStatus`, so a rejected send explains itself without a redeploy. Failures
are rethrown so the invocation counts against the Lambda `Errors` metric and the
scheduler's retry policy applies.

## Phase 2

- **Lesson service** -- add `services/lesson/template.yaml`, then a second
  `AWS::Serverless::Application` block in the root template. One `sam deploy`;
  the notifier's nested stack is untouched.
- **Real lesson content** -- change `services/notifier/src/lesson.mjs` to call
  that service. Scheduling, delivery and logging stay as they are.
- **Interactive buttons** ("done" / "snooze 10m") -- needs API Gateway plus a
  Telegram webhook to receive callbacks. Additive; does not affect the send path.
- **Alerting on failures** -- an `AWS::CloudWatch::Alarm` on the function's
  `Errors` metric wired to SNS.

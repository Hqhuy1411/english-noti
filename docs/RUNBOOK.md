# Runbook

Every command needed to build, deploy, verify, operate and tear down this
system, in the order you would actually run them. Region is `ap-southeast-1`
throughout; it is pinned in `samconfig.toml`.

Run everything from the project root (`english-reminder/`).

---

## 0. Prerequisites

```sh
node -v                  # need 20+; 22+ preferred (Lambda runtime is nodejs22.x)
aws --version            # AWS CLI v2
brew install aws-sam-cli # SAM CLI, if not present
sam --version
```

No `npm install` step exists, by design -- the Lambda has zero dependencies.

Confirm which identity you are deploying as:

```sh
aws sts get-caller-identity --region ap-southeast-1
```

---

## 1. Create the Telegram bot

Manual, in the Telegram app:

1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token.
2. **Send any message to your own new bot.** Mandatory: a chat does not appear in
   `getUpdates` until it has written to the bot, and a bot can never open a
   conversation first. Skipping this is the usual reason a new bot looks broken.

Confirm the token is live (prints the bot's identity, not the token):

```sh
curl -s "https://api.telegram.org/bot<TOKEN>/getMe"
```

---

## 2. Configure locally

```sh
cp .env.example .env
chmod 600 .env
# paste the token into TELEGRAM_BOT_TOKEN, then:
node services/notifier/scripts/get-chat-id.mjs   # prints TELEGRAM_CHAT_ID=...
```

Add the printed chat id to `.env`. `.env` is gitignored -- never commit it.

---

## 3. Verify locally, before touching AWS

```sh
node --test                                       # unit tests, 9 cases
node services/notifier/scripts/send-now.mjs       # real message, no AWS involved
```

`send-now.mjs` is the gate. If the message does not arrive, the problem is the
token or the chat id -- not AWS. Chasing an AWS error before this passes wastes
time.

---

## 4. Grant the deploying identity its permissions

Deploying needs more than a default developer user typically has. `docs/aws-permissions.json`
holds the least-privilege additions. Attach it (requires an admin identity, or
console access as an account owner):

```sh
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
sed "s/ACCOUNT_ID/$ACCOUNT_ID/" docs/aws-permissions.json > /tmp/english-reminder-policy.json

aws iam put-user-policy \
  --user-name <deploying-user> \
  --policy-name english-reminder-deploy \
  --policy-document file:///tmp/english-reminder-policy.json
```

Why each block is needed:

| Block | Reason |
|---|---|
| `s3:CreateBucket` + bucket config | `resolve_s3 = true` makes SAM create a managed bucket via its own `aws-sam-cli-managed-default` stack. Creating it also sets a policy, versioning, encryption and public-access-block, so those actions are required too. |
| `s3:PutObject` / `GetObject` | SAM uploads the code zip **and the nested stack template** there on every deploy. |
| `ssm:PutParameter` etc. | Storing and rotating the bot token. |
| `ssm:DescribeParameters` | Listing is an account-level action and cannot be scoped to a path, hence `Resource: "*"`. |

CloudFormation, Lambda, Logs, IAM role creation and EventBridge Scheduler
permissions are assumed already present.

### Checking a permission without guessing

Probing with deliberately invalid input is unreliable: **AWS validates input
before it authorizes**, so an `InvalidBucketName` or `ValidationError` proves
nothing about permissions. Only an explicit `AccessDenied` / `AccessDeniedException`
is evidence, and its absence is not evidence of the opposite. Use the real thing:

```sh
aws iam simulate-principal-policy \
  --policy-source-arn "$(aws sts get-caller-identity --query Arn --output text)" \
  --action-names s3:CreateBucket ssm:PutParameter \
  --region ap-southeast-1
```

Caveat: `iam:SimulatePrincipalPolicy` is itself a permission, and a restricted
user typically does not have it -- the call then fails with `AccessDenied` about
the simulate action, not about what you asked. When that happens there is no way
to answer the question from inside that identity: ask an admin to simulate, read
the attached policies from an admin identity, or simply attempt the real
operation and read the error.

---

## 5. Store the bot token

The token lives in SSM Parameter Store as a SecureString. It must never appear in
a template, a Lambda environment variable, or a log line.

```sh
set -a; . ./.env; set +a
aws ssm put-parameter \
  --name /english-reminder/telegram-bot-token \
  --type SecureString \
  --value "$TELEGRAM_BOT_TOKEN" \
  --description "Telegram bot token for the daily English reminder" \
  --region ap-southeast-1
```

Reading the value back from `.env` keeps the token out of shell history.

Confirm it exists without printing it:

```sh
aws ssm describe-parameters \
  --parameter-filters "Key=Name,Values=/english-reminder/telegram-bot-token" \
  --region ap-southeast-1 \
  --query 'Parameters[0].{Name:Name,Type:Type,KeyId:KeyId}'
```

CloudFormation cannot create this for you: `AWS::SSM::Parameter` supports
`String` and `StringList` only, never `SecureString`. That is why this step is
manual and out-of-band.

---

## 6. Deploy

```sh
sam validate --lint --region ap-southeast-1
sam build
sam deploy --parameter-overrides \
  TelegramChatId=<your-chat-id> \
  TestScheduleExpression='at(2026-08-24T09:00:00)'
```

`sam build` should report **both** environments:

```
functions: NotifierProd/NotifierFunction, NotifierTest/NotifierFunction
```

Notes:

- `TestScheduleExpression` has no default on purpose -- a one-shot `at(...)` must
  be in the future at deploy time or it silently never fires, so it should be a
  conscious choice every deploy.
- Add `--no-confirm-changeset` for a non-interactive deploy. `samconfig.toml`
  asks for confirmation by default.
- Two environments are created: `prod` (21:00 daily) and `test` (one-shot).

---

## 7. Verify the deployment

**The nested stack shape.** The root stack should own two
`AWS::CloudFormation::Stack` resources -- that is the SAM macro expanding
`AWS::Serverless::Application` server-side:

```sh
aws cloudformation list-stack-resources --stack-name english-reminder \
  --region ap-southeast-1 \
  --query 'StackResourceSummaries[].[LogicalResourceId,ResourceType]' --output text

aws cloudformation describe-stacks --stack-name english-reminder \
  --region ap-southeast-1 --query 'Stacks[0].Outputs' --output table
```

`sam build` output is *not* the expanded template. To see what CloudFormation
actually built:

```sh
aws cloudformation get-template --stack-name english-reminder \
  --template-stage Processed --region ap-southeast-1
```

**The functions run.** Invoke test first -- it is safe to invoke freely:

```sh
aws lambda invoke --function-name english-reminder-notifier-test \
  /dev/stdout --region ap-southeast-1

aws lambda invoke --function-name english-reminder-notifier-prod \
  /dev/stdout --region ap-southeast-1
```

A message should arrive in Telegram. This is what proves the execution role can
decrypt the SSM parameter and that the function has egress to the internet.

**The logs.** Each run emits one JSON object per line:

```sh
aws logs tail /aws/lambda/english-reminder-notifier-test \
  --since 15m --format short --region ap-southeast-1
```

Expect `invocation.start` then exactly one of `send.success` / `send.failure`.
In CloudWatch Logs Insights:

```
fields @timestamp, event, level, messageId, durationMs, description
| filter event like /send/
| sort @timestamp desc
```

**The schedules.**

```sh
aws scheduler get-schedule --name english-reminder-prod \
  --group-name default --region ap-southeast-1

aws scheduler get-schedule --name english-reminder-test \
  --group-name default --region ap-southeast-1
```

Check `ScheduleExpression`, `ScheduleExpressionTimezone: Asia/Ho_Chi_Minh`, and
`State: ENABLED`.

---

## 8. Operating it

**Re-arm the one-shot test** for a new time. No file edit -- the expression is a
stack parameter precisely so this stays a one-liner:

```sh
sam deploy --no-confirm-changeset --parameter-overrides \
  TelegramChatId=<id> TestScheduleExpression='at(2026-08-25T09:00:00)'
```

**Park the test environment** so nothing fires on a clock, while keeping the
function invokable on demand:

```sh
sam deploy --no-confirm-changeset --parameter-overrides \
  TelegramChatId=<id> TestScheduleExpression='at(2026-08-25T09:00:00)' \
  TestScheduleState=DISABLED
```

**Change the production time** (example: 20:30 instead of 21:00):

```sh
sam deploy --no-confirm-changeset --parameter-overrides \
  TelegramChatId=<id> TestScheduleExpression='at(...)' \
  ProdScheduleExpression='cron(30 20 * * ? *)'
```

Cron fields are `minute hour day-of-month month day-of-week year`, evaluated in
`Asia/Ho_Chi_Minh`. Never convert to UTC by hand.

**Rotate the bot token** (do this if the token was ever pasted into a chat, a
ticket, or a shared log):

```sh
# 1. In Telegram: @BotFather -> /revoke -> pick the bot -> copy the new token
# 2. Update .env, then:
set -a; . ./.env; set +a
aws ssm put-parameter --name /english-reminder/telegram-bot-token \
  --type SecureString --value "$TELEGRAM_BOT_TOKEN" --overwrite \
  --region ap-southeast-1
```

No redeploy needed -- the function reads the parameter at runtime. A warm
container caches it, so allow a few minutes or invoke twice.

---

## 9. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Failed to create managed resources: ... ROLLBACK_COMPLETE` | The SAM artifact bucket stack failed. Get the real reason from its events (below), fix the permission, delete the rolled-back stack, redeploy. |
| `ParameterNotFound` in the logs | Step 5 was skipped, or the parameter is in a different region. |
| `AccessDeniedException` from KMS in the logs | The default `alias/aws/ssm` key policy assumption broke. Add an explicit `kms:Decrypt` statement to the function's policy. |
| No message, `send.failure` with `description: Unauthorized` | The token is wrong or was revoked. Re-do step 5. |
| No message, `description: chat not found` | Wrong `TelegramChatId`, or you never messaged the bot (step 1). |
| One-shot never fired | `at(...)` was already in the past at deploy time. Re-arm with a future value. |
| `Requires capabilities: [CAPABILITY_AUTO_EXPAND]` | Nested stacks need it. It is pinned in `samconfig.toml`; something overrode it. |
| `UnauthorizedTaggingOperation` creating a role | Misleading: the tagging complaint is the wrapper. Read the nested message — usually `iam:CreateRole` denied. Both `iam:CreateRole` and `iam:TagRole` are required, since CloudFormation propagates stack tags onto the role. |
| Nested stack `CREATE_FAILED`, root `ROLLBACK_COMPLETE` | The reason lives on the *nested* stack, not the root. Pass the nested stack's full ARN (from the root's events) to `describe-stack-events`; it still works after the nested stack is deleted. |

Reading why a stack failed -- this is the command that actually answers it,
rather than the summary SAM prints:

```sh
aws cloudformation describe-stack-events --stack-name <stack> \
  --region ap-southeast-1 \
  --query 'StackEvents[?ResourceStatus==`CREATE_FAILED`].[LogicalResourceId,ResourceType,ResourceStatusReason]' \
  --output text
```

A stack stuck in `ROLLBACK_COMPLETE` cannot be updated, only deleted:

```sh
aws cloudformation delete-stack --stack-name <stack> --region ap-southeast-1
aws cloudformation wait stack-delete-complete --stack-name <stack> --region ap-southeast-1
```

---

## 10. Teardown

```sh
sam delete --stack-name english-reminder --region ap-southeast-1

# the token is deliberately outside the stack, so remove it separately
aws ssm delete-parameter --name /english-reminder/telegram-bot-token \
  --region ap-southeast-1

# optional: SAM's shared artifact bucket, if nothing else uses it
aws cloudformation delete-stack --stack-name aws-sam-cli-managed-default \
  --region ap-southeast-1
```

Deleting the stack also deletes the log groups, because they are declared as
stack resources rather than auto-created by Lambda.

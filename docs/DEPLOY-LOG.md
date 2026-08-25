# Deployment log

A record of what was actually deployed, what blocked it, and how each blocker was
diagnosed. Kept because the permission discovery took several rounds and the
failure modes were misleading — repeating that work would be wasteful.

For the commands themselves, see `docs/RUNBOOK.md`. This file is the history and
the account-specific facts.

---

## Environment

| Item | Value |
|---|---|
| AWS account | `655954777441` |
| Region | `ap-southeast-1` (Singapore) |
| Deploying identity | IAM user `huy-macair` (`arn:aws:iam::655954777441:user/huy-macair`) |
| Root stack | `english-reminder` |
| Nested stacks | `english-reminder-NotifierProd-*`, `english-reminder-NotifierTest-*` |
| SAM artifact bucket | `aws-sam-cli-managed-default-samclisourcebucket-0ii0xrev5myd` |
| SAM bucket stack | `aws-sam-cli-managed-default` (created by SAM, `CREATE_COMPLETE`) |
| Bot token parameter | `/english-reminder/telegram-bot-token`, `SecureString`, key `alias/aws/ssm` |
| Telegram bot | `@Hocbaidithangngu_bot` ("Học bài đi thằng ngu") |
| Local toolchain | AWS CLI v2.36.29, SAM CLI 1.165.0, Node v24.19.0 (Lambda runtime `nodejs22.x`) |

`TELEGRAM_CHAT_ID` lives in `.env` locally and is passed to the stack as a
parameter. It is not a secret, but it is not recorded here either — read it from
`.env` or from the deployed function's environment.

---

## The permission-probing trap, twice

**AWS validates input before it authorizes.** Probing a permission with
deliberately invalid arguments and treating `ValidationError` /
`InvalidBucketName` as "allowed" is wrong. It produced two false all-clears here,
each of which only surfaced as a mid-deploy stack rollback:

| Probe | Response | Wrong conclusion | Reality |
|---|---|---|---|
| `s3api create-bucket --bucket BAD_NAME` | `InvalidBucketName` | allowed | `s3:CreateBucket` **denied** |
| `iam create-role --role-name 'bad name!!'` | `ValidationError` | allowed | `iam:CreateRole` **denied** |

Only an explicit `AccessDenied` / `AccessDeniedException` is evidence of a denial.
Its absence is **not** evidence of a grant.

`aws iam simulate-principal-policy` is the correct tool, but it needs
`iam:SimulatePrincipalPolicy`, which this restricted user does not have — the
call fails with `AccessDenied` about the simulate action itself. From inside a
restricted identity there is no reliable way to enumerate your own permissions;
either ask an admin, or attempt the real operation and read the error.

---

## Chronology

### Round 1 — baseline

`aws sts get-caller-identity` confirmed the user. Attempting
`ssm:PutParameter` failed with `AccessDeniedException`. Broad probing (later shown
unreliable) suggested CloudFormation, Lambda and Logs were available.

### Round 2 — first deploy attempt

```
Error: Failed to create managed resources: Waiter StackCreateComplete failed:
... ROLLBACK_COMPLETE
```

Diagnosed with `describe-stack-events` on `aws-sam-cli-managed-default`:

```
SamCliSourceBucket  AWS::S3::Bucket
User huy-macair is not authorized to perform: s3:CreateBucket
```

So two blockers were confirmed: **S3** and **SSM**. The rolled-back
`aws-sam-cli-managed-default` stack was deleted — a stack in `ROLLBACK_COMPLETE`
cannot be updated, only deleted, and it blocks recreation under the same name.

### Round 3 — SSM granted, S3 still missing

The token stored successfully (`Version: 1`, `Tier: Standard`), confirming SSM was
fixed. Deploy failed identically on `s3:CreateBucket`. Rolled-back stack deleted
again.

### Round 4 — S3 granted via `AmazonS3FullAccess`

The S3 stage passed and the artifact bucket was created — it persists, so this
stage will not repeat. The failure moved one layer in: both nested stacks failed
on `NotifierFunctionRole`.

```
UnauthorizedTaggingOperation: Encountered a permissions error performing a
tagging operation ... User huy-macair is not authorized to perform:
iam:CreateRole on resource:
arn:aws:iam::655954777441:role/english-reminder-NotifierProd--NotifierFunctionRole-*
```

Note the error leads with a *tagging* complaint, which is misleading — the real
cause is in the nested message: `iam:CreateRole` denied. CloudFormation propagates
stack tags onto the role, so both `iam:CreateRole` and `iam:TagRole` are needed.

The root stack was left in `ROLLBACK_COMPLETE` and deleted.

### Round 5 — IAM granted via `IAMFullAccess`

Roles created fine. The failure moved one layer further in, to the schedule:

```
AccessDenied: User huy-macair is not authorized to perform:
scheduler:GetSchedule on resource:
arn:aws:scheduler:ap-southeast-1:655954777441:schedule/default/english-reminder-test
```

`scheduler:CreateSchedule` was already permitted, but CloudFormation **reads the
resource back after creating it**, so `GetSchedule` is required as well. A
partially-granted service is its own failure mode: the create succeeds and the
read-back fails, which looks like a creation error.

Listing the nested stack's successful resources narrowed the remaining gap to
exactly one resource type:

```
CREATE_COMPLETE  AWS::Logs::LogGroup        LogGroup
CREATE_COMPLETE  AWS::IAM::Role             NotifierFunctionRole
CREATE_COMPLETE  AWS::Lambda::Function      NotifierFunction
CREATE_COMPLETE  AWS::IAM::Role             NotifierFunctionReminderRole
CREATE_FAILED    AWS::Scheduler::Schedule   NotifierFunctionReminder
```

That query is the one worth remembering — it converts "the deploy failed" into
"exactly these permissions are still missing", instead of another round of
guessing.

### Round 6 — Scheduler granted, deploy succeeded

`AmazonEventBridgeSchedulerFullAccess` attached. The stack created cleanly:

```
Successfully created/updated stack - english-reminder in ap-southeast-1
```

Deploy wall-clock, cold: ~75 seconds.

Verified immediately afterwards:

| Check | Result |
|---|---|
| Root stack owns two nested stacks | `NotifierProd` and `NotifierTest`, both `AWS::CloudFormation::Stack`, `CREATE_COMPLETE` — the SAM `AWS::Serverless::Application` expansion working as designed |
| `english-reminder-notifier-test` invoked | `{"ok":true,"messageId":5}` |
| `english-reminder-notifier-prod` invoked | `{"ok":true,"messageId":6}` |
| Structured logs in CloudWatch | `invocation.start` then `send.success` with `messageId`, `chatId`, `durationMs`, parsed into fields |
| prod schedule | `cron(0 21 * * ? *)`, `Asia/Ho_Chi_Minh`, `ENABLED` |
| test schedule | `at(...)`, `Asia/Ho_Chi_Minh`, `ENABLED` |

The successful invocation settles an assumption that had been flagged as unproven:
a SecureString on the default `alias/aws/ssm` key **does not** need an explicit
`kms:Decrypt` statement in the function's policy. That key's policy already grants
the account access via `kms:ViaService`. No KMS error appeared.

Observed cold-start `durationMs` is ~4000 ms, which is the first SSM call plus
container init, not the Telegram request. Warm invocations reuse the cached token
and are far quicker.

### Round 7 — the schedule firing on its own

The two invocations above were manual, which proves the function but not the
scheduler. A one-shot aimed a few minutes out closed that gap:

```
{"event":"invocation.start","scheduledTime":"2026-08-23T06:49:00Z", ...}
{"event":"send.success","messageId":7,"durationMs":3812, ...}
```

Three things learned here, each correcting an earlier assumption:

- **EventBridge Scheduler does populate `time` in the event payload.** It was
  assumed empty. So `scheduledTime` in the logs distinguishes a scheduled firing
  from a manual `lambda invoke`, where it is `null`. Useful when auditing whether
  a day's reminder actually went out on schedule rather than by hand.
- **Measured latency from scheduled moment to handler start was ~36 seconds**
  (06:49:00Z scheduled, 06:49:36Z handler start), with `FlexibleTimeWindow: OFF`.
  The architecture decision was written up as "fires within seconds", which
  overstated it. It remains an order of magnitude better than GitHub Actions cron
  (5–30 minutes), so the choice stands — but 36 s is the honest figure, and a
  reminder that must land on an exact second is not what this delivers.
- **A one-shot schedule stays `ENABLED` after firing**, holding its now-past
  `at(...)` expression. It does not delete or disable itself. Harmless, since it
  will not fire again, but do not read a lingering ENABLED one-shot as pending
  work. `ActionAfterCompletion: DELETE` would clean it up if that ever matters.

### Round 8 (2026-08-25) — the study table's `DescribeTable`, and documentation is not a grant

Adding `services/study/`'s table (backlog 0001 / ADR 0009) reproduced the exact
shape of Round 5's trap: CloudFormation creates the resource, then reads it back,
and read-back is a separate permission from create.

```
User huy-macair is not authorized to perform: dynamodb:DescribeTable on resource:
arn:aws:dynamodb:ap-southeast-1:655954777441:table/english-reminder-study
```

`dynamodb:CreateTable` was allowed; `dynamodb:DescribeTable` was not, so the
create succeeded and the read-back failed, surfacing as `CREATE_FAILED` on
`StudyTable`.

What makes this worth its own entry rather than a line under Round 5: **the
permission was already written down.** The `StudyTable` / `StudyTableList`
statements — fourteen control-plane actions, including `DescribeTable` — were
added to `docs/aws-permissions.json` in commit `a0da6f7`, before this deploy was
attempted. The rollback happened anyway, because that file documents what the
stack needs; it does not attach anything to an IAM identity. Nobody had applied
it to `huy-macair`. Writing a permission down and granting it are two different
actions, and only one of them was done.

Fixed with an inline policy on `huy-macair`, `english-reminder-study-table`: the
`StudyTable` statement's fourteen actions, scoped to
`arn:aws:dynamodb:ap-southeast-1:655954777441:table/english-reminder-study`, plus
`dynamodb:ListTables` on `*` (cannot be scoped to one table — same shape as
`scheduler:ListSchedules` in Round 6). `dynamodb:GetItem` and `dynamodb:Query`
were added afterwards, read-only, so the table could be inspected without a
redeploy. Second attempt succeeded: `english-reminder-study` is `ACTIVE`,
`PAY_PER_REQUEST`, with `GSI1` (ADR 0010).

### Lesson: enumerate, do not iterate

Five deploys were spent discovering permissions one at a time, because each
failure only reveals the *first* missing permission. Granting the full set from
`docs/aws-permissions.json` up front would have taken one round. For the next
service, attach the policy first and let the deploy confirm it — do not treat the
deploy as a permission discovery tool.

---

## Permissions: required vs. granted

| Area | Needed for | Status |
|---|---|---|
| CloudFormation | root + nested stacks | ✅ present from the start |
| Lambda | function create/update | ✅ present from the start |
| CloudWatch Logs | explicit log groups | ✅ present from the start |
| EventBridge Scheduler | `CreateSchedule` | ⚠️ partially — see below |
| SSM | store and read the bot token | ✅ granted in round 3 |
| S3 | SAM artifact bucket + uploads | ✅ granted in round 4 via `AmazonS3FullAccess` |
| IAM | Lambda + scheduler execution roles | ✅ granted in round 5 via `IAMFullAccess` |
| EventBridge Scheduler | create **and read back** the schedule | ✅ granted in round 6 via `AmazonEventBridgeSchedulerFullAccess` |
| DynamoDB | create **and read back** (`DescribeTable`) the study table | ⚠️ documented in `docs/aws-permissions.json` since it was written, not actually granted until round 8 — ✅ granted via inline policy `english-reminder-study-table` |

Note that "EventBridge Scheduler present from the start" in the round-1 table was
wrong: `CreateSchedule` was allowed while `GetSchedule` was not. Treat a service
as available only when the specific actions a deploy performs are all allowed.

### A note on `AmazonS3FullAccess`

It unblocked the deploy, but it grants full S3 across every bucket in the
account. The scoped equivalent is the `SamManagedArtifactBucketCreate` and
`SamManagedArtifactObjects` statements in `docs/aws-permissions.json`, limited to
`aws-sam-cli-managed-default-*`. Worth swapping to once things are stable.

If IAM access is granted via `IAMFullAccess`, understand that it is effectively
account-admin: anyone holding it can create a role with any permissions and pass
it to a service. The scoped statement restricted to `role/english-reminder-*` is
strongly preferable and no slower to attach.

---

## What is deployed right now

Stack `english-reminder` is live in `ap-southeast-1`, with two nested stacks:

| Environment | Function | Log group | Schedule |
|---|---|---|---|
| prod | `english-reminder-notifier-prod` | `/aws/lambda/english-reminder-notifier-prod` | `english-reminder-prod`, `cron(0 21 * * ? *)` |
| test | `english-reminder-notifier-test` | `/aws/lambda/english-reminder-notifier-test` | `english-reminder-test`, one-shot `at(...)` |

Plus, since Round 8, the `services/study/` nested stack: table
`english-reminder-study`, `ACTIVE`, `PAY_PER_REQUEST`, index `GSI1` (key schema
in ADR 0010). No Lambda of its own — both notifier environments read/write it
in-process via `services/notifier/src/study/ddb.mjs`.

Also live, and deliberately outside the stack:

- `aws-sam-cli-managed-default` stack and its S3 bucket — SAM reuses these.
- `/english-reminder/telegram-bot-token` in SSM — CloudFormation cannot create a
  `SecureString` parameter (`AWS::SSM::Parameter` supports `String` and
  `StringList` only), so it is created by hand and is not owned by the stack.
  Deleting the stack does **not** delete the token.

Verified locally throughout, independent of AWS: `node --test` 9/9 passing,
`sam validate --lint` clean, `sam build` producing both
`NotifierProd/NotifierFunction` and `NotifierTest/NotifierFunction`, and a real
Telegram message delivered from the local machine (`message_id=4`).

---

## Security follow-up

The bot token was pasted into a chat transcript during setup. Rotate it via
`@BotFather` → `/revoke`, then update `.env` and the SSM parameter with
`--overwrite` (procedure in `docs/RUNBOOK.md` §8). No redeploy is needed, since
the function reads the parameter at runtime.

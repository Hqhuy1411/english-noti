# english-reminder

Serverless reminder system. Phase 1 (done): a Lambda fires at 21:00
Asia/Ho_Chi_Minh and sends a Telegram message. Phase 2: a separate lesson
service supplies real English-learning content.

Run every command from this directory (`english-reminder/`), not from `tools/`.

`docs/RUNBOOK.md` has every build, deploy, verify, operate and teardown command,
plus a troubleshooting table. `docs/DEPLOY-LOG.md` records account-specific facts
(stack names, bucket, region) and the history of what blocked deployment. Check
both before reconstructing a command or re-diagnosing a permission.

## Tooling in `.claude/`

| Path | What it does |
|---|---|
| `commands/deploy.md` | `/deploy` — validates, builds, resolves a future-dated one-shot for the test schedule, deploys, then reports the schedules as they actually ended up. |
| `commands/status.md` | `/status` — read-only health check: next fire times, last run and its outcome, and whether a run was scheduled or hand-triggered. Never invokes a function. |
| `skills/cfn-deploy-triage/` | Procedure for a rolled-back deploy: read the *nested* stack's events, list what succeeded to narrow the gap, and avoid the two permission traps that cost five deploys here. |
| `agents/convention-keeper.md` | Subagent that maintains this file. |
| `hooks/validate-template.sh` | `PostToolUse` on Write/Edit: runs `sam validate --lint` on any edited `template.yaml` and feeds the error back. Enforces the "validate after any template change" rule instead of relying on memory. |
| `settings.json` | Wires the hook. Allows read-only AWS verification commands without prompting; **denies** `Read(./.env)` and `aws ssm get-parameter`, so the bot token cannot be printed into a transcript by accident. |

A newly added `.claude/settings.json` is not picked up mid-session — the settings
watcher only watches directories that already had a settings file at startup.
Open `/hooks` once, or restart, to load it.

## Conventions

These are decisions already made and paid for. Follow them; if you think one is
wrong, say so before working around it.

### Dependencies: zero, deliberately

The Lambda has **no npm dependencies** and no `package.json`. Node 22 built-ins
cover everything: `fetch` for HTTP, `Intl` for timezone formatting,
`process.loadEnvFile()` for local `.env`. The AWS SDK v3 ships inside the
`nodejs22.x` runtime and is imported **lazily** (`await import(...)`) so local
scripts run with no `node_modules` at all.

Before adding any dependency, check whether a Node built-in does it. The payoff
is a few-KB deploy package and ~200ms cold start.

### Secrets

- The bot token lives in **SSM Parameter Store as a SecureString** at
  `/english-reminder/telegram-bot-token`. It is created out-of-band by the user.
- A secret must never reach a CloudFormation template, a Lambda environment
  variable, or a log line. `TELEGRAM_CHAT_ID` is not a secret and *is* an env var.
- The Telegram token sits in the **request URL**, so errors in `telegram.mjs` are
  built from the method name only — never from the URL, or the token leaks into
  every stack trace. `test/notifier.test.mjs` asserts the token appears in
  neither the error message, the stack, nor any log line. Keep those passing.
- Local development reads `.env` (gitignored, mode 600). Never commit it.

### Infrastructure as code

Root `template.yaml` is a CloudFormation stack that declares each service as an
`AWS::Serverless::Application`, which the SAM macro expands **server-side at
deploy time** into an `AWS::CloudFormation::Stack`. So: one root stack, one
nested stack per service, each service written in terse SAM syntax.

- Adding a service = new `services/<name>/template.yaml` + one
  `AWS::Serverless::Application` block in the root template. Nothing else moves.
- Nested stacks require `CAPABILITY_AUTO_EXPAND`. It is pinned in
  `samconfig.toml`; omitting it fails with an opaque "Requires capabilities" error.
- `sam build` output is **not** the expanded template. To see what CloudFormation
  actually built: `aws cloudformation get-template --template-stage Processed`.
- Schedules use `Type: ScheduleV2` (EventBridge Scheduler). Never `Schedule` —
  that is the old EventBridge Rules path and **cannot express a timezone**.
- Declare `AWS::Logs::LogGroup` explicitly with `RetentionInDays`. Do not let
  Lambda auto-create it, or retention is unmanaged and logs survive stack deletion.
- IAM comes from SAM policy templates scoped to a path
  (`SSMParameterWithSlashPrefixReadPolicy` on `/english-reminder/*`), never a
  broad managed policy.
- Region `ap-southeast-1`, architecture `arm64`, runtime `nodejs22.x`.

### Two environments, one service template

The root template instantiates `services/notifier/template.yaml` twice, as
`NotifierProd` and `NotifierTest`. An `EnvironmentName` parameter (`prod` | `test`)
suffixes every resource name -- function, log group, schedule -- so both live in
one account without collision, and is passed to the function so `lesson.mjs`
labels a test message `[TEST]`. A test firing must never be mistakable for the
real reminder.

- **prod**: `cron(0 21 * * ? *)`, daily, always `ENABLED`.
- **test**: a one-shot `at(yyyy-mm-ddThh:mm:ss)`. One-shots do not repeat, so
  re-arming means redeploying with a new value. `TestScheduleExpression` has
  deliberately **no default** -- an `at(...)` already in the past silently never
  fires, so it should be a conscious choice on every deploy. After firing, a
  one-shot stays `ENABLED` with its past expression; it does not self-delete, so
  a lingering ENABLED one-shot is not pending work.

Adding a third environment is a parameter value, not a new template. Resist
copying the service template.

### Anything you would edit a file to test becomes a Parameter

`ScheduleExpression` is a stack Parameter specifically so the schedule can be
smoke-tested with `--parameter-overrides` and no file edit. Apply the same rule
to future knobs: a test that requires editing a template will not get run.

### Scheduling and time

All scheduling is declared in `Asia/Ho_Chi_Minh` via
`ScheduleExpressionTimezone`. Never do UTC arithmetic by hand. Message content
formats its timestamp with `Intl` in the same zone, so a received message is
itself proof the schedule fired at the right local time.

### Logging

One JSON object per line to stdout (stderr for `ERROR`), always carrying
`level`, `event`, `ts`. CloudWatch parses that into queryable fields — no parsing
config needed. Event names are namespaced with a dot: `invocation.start`,
`send.success`, `send.failure`.

`scheduledTime` comes from the EventBridge Scheduler event and is `null` on a
manual `lambda invoke` -- that is how you tell a real scheduled reminder from a
hand-triggered one when auditing.

A failed send logs Telegram's own `description`, `errorCode` and `httpStatus`, so
a rejection explains itself without a redeploy. Then it **rethrows** — that is
what marks the invocation errored on the `Errors` metric and lets the scheduler
retry. Do not swallow errors to make a run look clean.

### Tests

`node --test` from this directory. The Node built-in runner, no dependency, with
`fetch` stubbed — the suite touches no network and no AWS. Note the bare
directory form (`node --test path/to/test/`) fails; use plain `node --test` or a
glob.

Tests live in `services/notifier/test/`, deliberately outside `src/`, which is
what `CodeUri` points at — so they never ship in the deploy package.

### Verify locally before touching AWS

`services/notifier/scripts/` talks only to Telegram and needs no AWS
credentials. `send-now.mjs` is the gate: if the message does not arrive from your
own machine, the problem is the token or the chat id, not AWS. Keep that property
— a script in there must never require AWS.

### Phase 2 seam

`services/notifier/src/lesson.mjs` is the **only** file that changes when real
lesson content arrives. Scheduling, delivery and logging stay untouched. Keep the
seam that narrow.

### Code style

ESM `.mjs` throughout. Comments are in English, explain *why* rather than what,
and sit at the top of a module to say what it is for. Vietnamese belongs in
user-facing message text, not in code comments.

## Facts worth not rediscovering

- A Telegram bot **cannot** message someone who has never messaged it first, and
  a chat does not appear in `getUpdates` until then. This is the usual cause of a
  new bot appearing broken.
- `getUpdates` without an `offset` does **not** consume updates, so polling it is
  safe and repeatable.
- With a SecureString on the default `alias/aws/ssm` key, no explicit
  `kms:Decrypt` statement is needed in the function's policy: that key's policy
  already grants the account access via `kms:ViaService`. Confirmed by a real
  invocation, not assumed. If a KMS `AccessDeniedException` ever appears in the
  logs, a non-default key is in play — add the statement then.
- GitHub Actions cron was rejected for scheduling: it routinely runs 5–30 minutes
  late and can skip runs under load. Do not reintroduce it for anything that must
  be punctual. Measured EventBridge Scheduler latency here was ~36 s from the
  scheduled moment to handler start with `FlexibleTimeWindow: OFF` -- far better,
  but not second-accurate. Do not promise second-accuracy on top of it.
- **AWS validates input before it authorizes.** Probing a permission with
  deliberately invalid arguments and reading `ValidationError` / `InvalidBucketName`
  as "allowed" is wrong, and it produced a false all-clear on `s3:CreateBucket`
  here that only surfaced as a stack rollback mid-deploy. Only an explicit
  `AccessDenied` is evidence; its absence is not evidence of the opposite. Use
  `aws iam simulate-principal-policy` when the answer matters.
- CloudFormation **cannot** create a SecureString SSM parameter --
  `AWS::SSM::Parameter` supports `String` and `StringList` only. The bot token is
  therefore created out-of-band, by hand, and is not owned by the stack. That is
  a constraint, not an oversight; do not "fix" it by moving the token into the
  template.
- The deploying identity needs S3, SSM **and IAM role-creation** permissions that a
  default developer user usually lacks. `docs/aws-permissions.json` holds the
  least-privilege set, the reasoning is in `docs/RUNBOOK.md`, and
  `docs/DEPLOY-LOG.md` records which were missing and how each was found.
- A CloudFormation `UnauthorizedTaggingOperation` on a role leads with a tagging
  complaint, but the real cause is usually in the nested message — here,
  `iam:CreateRole` denied. Read past the first sentence. CloudFormation propagates
  stack tags onto roles, so `iam:TagRole` is genuinely needed too.

## Don't claim it works until it ran

State what was actually executed and what its output was. "Should work" is not a
result. `sam validate --lint` and `sam build` are cheap — run them after any
template change.

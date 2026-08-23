---
paths:
  - "**/template.yaml"
  - "samconfig.toml"
---

# Infrastructure conventions

Loaded when a CloudFormation/SAM template is in play. These are decisions already
made and paid for — see `docs/decisions/` for the reasoning and the rejected
alternatives. If you think one is wrong, say so before working around it.

## Shape of the stack

Root `template.yaml` declares each service as an `AWS::Serverless::Application`,
which the SAM macro expands **server-side at deploy time** into an
`AWS::CloudFormation::Stack`. So: one root stack, one nested stack per service,
each service written in terse SAM syntax.

- Adding a service = new `services/<name>/template.yaml` + one
  `AWS::Serverless::Application` block in the root template. Nothing else moves.
- Nested stacks require `CAPABILITY_AUTO_EXPAND`. It is pinned in
  `samconfig.toml`; omitting it fails with an opaque "Requires capabilities" error.
- `sam build` output is **not** the expanded template. To see what CloudFormation
  actually built: `aws cloudformation get-template --template-stage Processed`.

## Non-negotiables

- Schedules use `Type: ScheduleV2` (EventBridge Scheduler). Never `Schedule` —
  that is the old EventBridge Rules path and **cannot express a timezone**.
- Declare `AWS::Logs::LogGroup` explicitly with `RetentionInDays`. Do not let
  Lambda auto-create it, or retention is unmanaged and logs survive stack deletion.
- IAM comes from SAM policy templates scoped to a path
  (`SSMParameterWithSlashPrefixReadPolicy` on `/english-reminder/*`), never a
  broad managed policy.
- Region `ap-southeast-1`, architecture `arm64`, runtime `nodejs22.x`.
- No secret may appear in a template — not as a default, not as a literal, not in
  a `Description`. The bot token is read from SSM at runtime, by design.

## Two environments, one service template

The root template instantiates `services/notifier/template.yaml` twice, as
`NotifierProd` and `NotifierTest`. An `EnvironmentName` parameter (`prod` | `test`)
suffixes every resource name — function, log group, schedule — so both live in one
account without collision, and is passed to the function so `lesson.mjs` labels a
test message `[TEST]`. A test firing must never be mistakable for the real reminder.

- **prod**: `cron(0 21 * * ? *)`, daily, always `ENABLED`.
- **test**: a one-shot `at(yyyy-mm-ddThh:mm:ss)`. One-shots do not repeat, so
  re-arming means redeploying with a new value. `TestScheduleExpression` has
  deliberately **no default** — an `at(...)` already in the past silently never
  fires, so it should be a conscious choice on every deploy. After firing, a
  one-shot stays `ENABLED` with its past expression; it does not self-delete, so a
  lingering ENABLED one-shot is not pending work.

Adding a third environment is a parameter value, not a new template. Resist
copying the service template.

## Anything you would edit a file to test becomes a Parameter

`ScheduleExpression` is a stack Parameter specifically so the schedule can be
smoke-tested with `--parameter-overrides` and no file edit. Apply the same rule to
future knobs: a test that requires editing a template will not get run.

## Scheduling and time

All scheduling is declared in `Asia/Ho_Chi_Minh` via `ScheduleExpressionTimezone`.
Never do UTC arithmetic by hand. Message content formats its timestamp with `Intl`
in the same zone, so a received message is itself proof the schedule fired at the
right local time.

Measured latency here was ~36 s from the scheduled moment to handler start with
`FlexibleTimeWindow: OFF`. Good, but not second-accurate — do not promise
second-accuracy on top of it.

## After any change

`sam validate --lint` and `sam build` are cheap. Run both. The
`.claude/hooks/validate-template.sh` hook runs the first one for you on every
edit; a red hook is a real failure, not noise.

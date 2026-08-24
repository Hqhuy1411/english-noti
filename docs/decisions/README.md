# Architecture decision records

One decision per file: what was chosen, **what was rejected and why**, and what it
costs. The rejected half is the valuable half — without it a decision reads as
arbitrary and gets overturned by the next person who finds it inconvenient.

These used to live in `CLAUDE.md` under "Conventions". They were moved here because
that file is loaded into every session's context, and a decision only needs to be
read when someone is about to change it.

| ADR | Decision |
|---|---|
| [0001](0001-zero-npm-dependencies.md) | No npm dependencies in the Lambda; Node 22 built-ins only, AWS SDK imported lazily |
| [0002](0002-nested-sam-stacks.md) | One root stack, one nested stack per service via `AWS::Serverless::Application` |
| [0003](0003-eventbridge-scheduler.md) | EventBridge Scheduler `ScheduleV2`; not Actions cron, not EventBridge Rules |
| [0004](0004-bot-token-out-of-band-ssm.md) | Bot token in SSM as a SecureString, created by hand, not owned by the stack |
| [0005](0005-one-template-two-environments.md) | Two environments from one service template via `EnvironmentName` |
| [0006](0006-testable-knobs-are-parameters.md) | Anything you would edit a file to test becomes a stack Parameter |
| [0007](0007-lesson-mjs-is-the-only-phase-2-seam.md) | `lesson.mjs` is the only file Phase 2 changes |
| [0008](0008-run-history-is-a-committed-file.md) | Run history is a committed file, harvested from CloudWatch before its 30-day retention drops it |

## Adding one

Next number, `NNNN-<slug>.md`, sections **Context / Decision / Rejected
alternatives / Consequences / Evidence**. Add a row above. Point *Evidence* at a
real file or a `docs/DEPLOY-LOG.md` round — a claim with no evidence is an
aspiration.

Superseding beats editing: leave the old ADR in place, set its **Status** to
`superseded by NNNN`, and write the new one. The history of what was tried is the
reason this directory exists.

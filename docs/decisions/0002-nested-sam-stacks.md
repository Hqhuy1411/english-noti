# 0002 — One root stack, one nested stack per service

**Status:** accepted · **Date:** 2026-08 · **Applies to:** `template.yaml`, `samconfig.toml`

## Context

Phase 2 adds a lesson service beside the notifier. A single flat template would
grow to hold both, and deploying a change to one would put the other's resources
in the same change set.

## Decision

Root `template.yaml` is a CloudFormation stack that declares each service as an
`AWS::Serverless::Application`. The SAM macro expands that **server-side at deploy
time** into an `AWS::CloudFormation::Stack`. Result: one root stack, one nested
stack per service, each service written in terse SAM syntax in its own file.

Adding a service = new `services/<name>/template.yaml` + one
`AWS::Serverless::Application` block in the root template. Nothing else moves.

## Rejected alternatives

- **One flat template** — every deploy touches every resource; the blast radius of
  a notifier change includes the lesson service.
- **One independent stack per service, deployed separately** — loses a single
  `sam deploy`, and cross-service references become manual output plumbing.
- **CDK** — would reintroduce a `node_modules` and a synth step, against 0001.

## Consequences

- Nested stacks require `CAPABILITY_AUTO_EXPAND`. It is pinned in
  `samconfig.toml`; omitting it fails with an opaque *"Requires capabilities"*
  error that does not mention nesting.
- `sam build` output is **not** the expanded template. To see what CloudFormation
  actually built:
  `aws cloudformation get-template --stack-name english-reminder --template-stage Processed`.
  This tripped up verification once already.
- Stack events for a failed resource live on the **nested** stack, not the root.
  The root only names the nested stack. See the `cfn-deploy-triage` skill.

## Evidence

`docs/DEPLOY-LOG.md` rounds 2–6; `.claude/skills/cfn-deploy-triage/SKILL.md`.

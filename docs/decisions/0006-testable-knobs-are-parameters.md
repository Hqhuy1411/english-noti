# 0006 — Anything you would edit a file to test becomes a stack Parameter

**Status:** accepted · **Date:** 2026-08 · **Applies to:** all templates

## Context

Smoke-testing the daily schedule originally meant editing the cron expression in
`template.yaml`, deploying, watching, then editing it back. That is a test with a
dirty working tree and a manual revert step — so it does not get run, and when it
does, the revert gets forgotten.

## Decision

Any value you would otherwise edit a file to exercise becomes a CloudFormation
**Parameter**, so it can be overridden with `--parameter-overrides` and no file
edit. `ScheduleExpression` exists as a Parameter for exactly this reason.

Apply the rule to future knobs: **a test that requires editing a template will not
get run.**

## Rejected alternatives

- **Edit and revert** — the status quo being replaced. Leaves the repo dirty and
  depends on remembering to undo it.
- **A separate "test" template** — divergence, per 0005.
- **Environment variables on the function** — works for runtime behaviour but not
  for infrastructure shape; a schedule expression is not something the handler
  reads.

## Consequences

- Smoke-testing the schedule needs no file edit and no revert, so it is actually
  performed. `docs/RUNBOOK.md` §7 documents it as a one-liner.
- Parameter list grows, and each parameter needs a sane default — or, as with
  `TestScheduleExpression`, a deliberate absence of one (see 0005).
- `samconfig.toml` carries the everyday values so the common `sam deploy` stays
  short.

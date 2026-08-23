# 0001 — No npm dependencies in the Lambda

**Status:** accepted · **Date:** 2026-08 · **Applies to:** `services/*/src/`, `services/*/scripts/`

## Context

The notifier needs to make one HTTPS request, format one timestamp in a named
timezone, and read one parameter from SSM. Every one of those has a popular npm
package. The function runs about 30 times a month.

## Decision

Ship **zero** npm dependencies and no `package.json`. Use Node 22 built-ins:
`fetch` for HTTP, `Intl` for timezone formatting, `process.loadEnvFile()` for the
local `.env`. Import the AWS SDK v3 — which already ships inside the `nodejs22.x`
runtime — **lazily** with `await import(...)`, so the local scripts run with no
`node_modules` present at all.

Before adding any dependency, check whether a Node built-in does it.

## Rejected alternatives

- **`axios` / `node-fetch`** — `fetch` has been stable in Node since 18. A
  dependency here buys nothing and costs a lockfile, a supply-chain surface, and
  an audit obligation.
- **`date-fns-tz` / `luxon`** — `Intl.DateTimeFormat` with `timeZone:
  'Asia/Ho_Chi_Minh'` is exactly the feature needed, and it is in the runtime.
- **Bundling the AWS SDK** — it is already in the runtime image. Bundling it
  would multiply the package size for an identical result.
- **Eager `import` of the SDK at module top level** — that would make
  `scripts/send-now.mjs` unrunnable without `node_modules`, destroying the
  no-AWS-needed property that makes it a useful diagnostic gate (see 0006's
  sibling rule in `.claude/rules/tests-and-scripts.md`).

## Consequences

- Deploy package is a few KB; measured cold start ~200 ms.
- No `npm install`, no lockfile, no dependency CVE triage.
- `node --test` needs no setup, which is why the suite actually gets run.
- **Cost:** anything a built-in does not cover must be written by hand. Accepted
  deliberately at this size. If Phase 2 needs a real HTML parser or a scheduler
  library, revisit this ADR rather than quietly adding a `package.json`.

## Evidence

`services/notifier/src/` has no imports outside `node:` and the lazy SDK import.
`docs/DEPLOY-LOG.md` records the resulting package size and cold start.

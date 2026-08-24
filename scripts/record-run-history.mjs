/**
 * Append every reminder run found in CloudWatch Logs to docs/RUN-HISTORY.md.
 *
 * Why this exists: the log groups have a 30-day retention (LogRetentionDays),
 * so CloudWatch is a rolling window, not a record. Anything older than 30 days
 * is gone. This script copies runs out of that window into a committed file
 * before they expire, which is the only durable history the project has.
 *
 * It is additive and idempotent: existing rows are never rewritten or dropped,
 * and a run already in the file (matched on requestId) is skipped. So rows for
 * runs CloudWatch has already forgotten survive every future run of this script.
 *
 * This script needs AWS credentials, which is why it is NOT under
 * services/<svc>/scripts/ -- those must stay AWS-free (.claude/rules/tests-and-scripts.md).
 *
 * Usage:
 *   node scripts/record-run-history.mjs             # merge new runs into the file
 *   node scripts/record-run-history.mjs --dry-run   # print what would be added
 *   node scripts/record-run-history.mjs --days 7    # narrow the lookback window
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REGION = 'ap-southeast-1';
const ENVIRONMENTS = ['prod', 'test'];
const TZ = 'Asia/Ho_Chi_Minh';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const historyPath = resolve(repoRoot, 'docs/RUN-HISTORY.md');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const days = Number(args[args.indexOf('--days') + 1]) || 30;

/** Read the structured log events one environment emitted in the window. */
function fetchEvents(environment) {
  const startTime = Date.now() - days * 86400 * 1000;
  const out = execFileSync(
    'aws',
    [
      'logs', 'filter-log-events',
      '--log-group-name', `/aws/lambda/english-reminder-notifier-${environment}`,
      '--region', REGION,
      '--start-time', String(startTime),
      // Only our own JSON log lines; skips START/END/REPORT noise.
      '--filter-pattern', '{ $.event = "*" }',
      '--query', 'events[].message',
      '--output', 'json',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return JSON.parse(out).map((line) => JSON.parse(line));
}

/**
 * Fold the per-line events into one record per invocation.
 * invocation.start carries the trigger; send.success / send.failure the outcome.
 */
function foldRuns(events, environment) {
  const runs = new Map();

  for (const e of events) {
    const run = runs.get(e.requestId) ?? { requestId: e.requestId, environment };
    runs.set(e.requestId, run);

    if (e.event === 'invocation.start') {
      run.startedAt = e.ts;
      // scheduledTime is non-null only when EventBridge Scheduler invoked it.
      run.trigger = e.scheduledTime ? 'scheduled' : 'manual';
    } else if (e.event === 'send.success') {
      run.outcome = 'sent';
      run.detail = `message ${e.messageId}`;
      run.durationMs = e.durationMs;
    } else if (e.event === 'send.failure') {
      run.outcome = 'FAILED';
      // Telegram's own words explain the failure without further digging.
      run.detail = e.description ?? e.errorMessage ?? e.errorName ?? 'unknown';
      run.durationMs = e.durationMs;
    }
  }

  return [...runs.values()];
}

/** A run that started but never logged an outcome -- a timeout, or a crash. */
function normalise(run) {
  if (!run.outcome) {
    run.outcome = 'no outcome logged';
    run.detail = 'started, never reported -- timeout or crash';
  }
  return run;
}

const vnTime = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TZ,
  dateStyle: 'short',
  timeStyle: 'medium',
});

function toRow(run) {
  const when = run.startedAt ? vnTime.format(new Date(run.startedAt)) : '(unknown)';
  const duration = run.durationMs ? `${run.durationMs} ms` : '--';
  return `| ${when} | ${run.environment} | ${run.trigger ?? '--'} | ${run.outcome} | ${run.detail} | ${duration} | ${run.requestId} |`;
}

const HEADER = `# Run history

Every invocation of the reminder, oldest first. **This file is the durable
record**: the CloudWatch log groups keep only 30 days, so a run that is not
copied here before it expires is lost for good.

Generated -- do not hand-edit rows. Refresh it with:

\`\`\`
node scripts/record-run-history.mjs
\`\`\`

That merges anything new and never rewrites or removes an existing row, so rows
older than CloudWatch's retention stay put. Times are Asia/Ho_Chi_Minh.

- **trigger** -- \`scheduled\` means EventBridge Scheduler fired it. \`manual\` means a
  hand-run \`lambda invoke\`, which is **not** evidence the schedule works.
- **outcome** -- \`sent\` carries the Telegram message id; \`FAILED\` carries Telegram's
  own explanation.

For deploys rather than runs, see \`docs/DEPLOY-LOG.md\`.

| When (VN) | Env | Trigger | Outcome | Detail | Duration | Request id |
|---|---|---|---|---|---|---|`;

// --- merge -------------------------------------------------------------

const existing = existsSync(historyPath) ? readFileSync(historyPath, 'utf8') : '';
const existingRows = existing
  .split('\n')
  .filter((l) => l.startsWith('| ') && !l.startsWith('| When') && !l.startsWith('|---'));
const knownIds = new Set(
  existingRows.map((l) => l.split('|').at(-2)?.trim()).filter(Boolean),
);

const fresh = ENVIRONMENTS.flatMap((env) => {
  try {
    return foldRuns(fetchEvents(env), env).map(normalise);
  } catch (err) {
    // A missing log group (environment torn down) must not lose the other one.
    console.error(`! could not read ${env}: ${err.message.trim().split('\n').at(-1)}`);
    return [];
  }
})
  .filter((run) => !knownIds.has(run.requestId))
  .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));

if (fresh.length === 0) {
  console.log(`No new runs. ${existingRows.length} already recorded.`);
  process.exit(0);
}

const newRows = fresh.map(toRow);

if (dryRun) {
  console.log(`Would add ${newRows.length} run(s):`);
  console.log(newRows.join('\n'));
  process.exit(0);
}

const allRows = [...existingRows, ...newRows];
writeFileSync(historyPath, `${HEADER}\n${allRows.join('\n')}\n`);
console.log(`Added ${newRows.length} run(s); ${allRows.length} recorded in docs/RUN-HISTORY.md`);

/**
 * Structured JSON logging.
 *
 * CloudWatch Logs parses a log line that is a single JSON object into
 * queryable fields, so `event`, `durationMs`, etc. become filterable in
 * Logs Insights without any extra parsing config.
 *
 * Never pass a bot token or any other secret into `fields`.
 */

const write = (level, event, fields) => {
  const line = JSON.stringify({
    level,
    event,
    ts: new Date().toISOString(),
    ...fields,
  });
  if (level === 'ERROR') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
};

export const info = (event, fields = {}) => write('INFO', event, fields);
export const warn = (event, fields = {}) => write('WARN', event, fields);
export const error = (event, fields = {}) => write('ERROR', event, fields);

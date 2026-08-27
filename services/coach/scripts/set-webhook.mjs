/**
 * Point the Telegram bot at the deployed webhook.
 *
 * Talks to Telegram only -- no AWS credentials, per the rule in
 * .claude/rules/tests-and-scripts.md. That is why the URL is an argument rather
 * than something this script looks up: reading a stack output would need AWS
 * access and turn a Telegram problem into an AWS one.
 *
 *   node services/coach/scripts/set-webhook.mjs <webhook-url> <secret>
 *
 * Get the URL from the stack:
 *   aws cloudformation describe-stacks --stack-name english-reminder \
 *     --region ap-southeast-1 \
 *     --query 'Stacks[0].Outputs[?OutputKey==`WebhookUrl`].OutputValue' --output text
 *
 * The secret must be the same value stored at
 * /english-reminder/telegram-webhook-secret. Pass it on stdin rather than as an
 * argument if you would rather it stayed out of your shell history:
 *   ... set-webhook.mjs <url> -   # then paste the secret
 */

import { loadEnv } from '../../notifier/scripts/load-env.mjs';
import { readFileSync } from 'node:fs';

loadEnv();

const [url, secretArg] = process.argv.slice(2);
const token = process.env.TELEGRAM_BOT_TOKEN;

if (!url || !token) {
  console.error(
    'Usage: node services/coach/scripts/set-webhook.mjs <webhook-url> [secret|-]\n' +
      'TELEGRAM_BOT_TOKEN must be in .env',
  );
  process.exit(1);
}

const secret =
  secretArg === '-'
    ? readFileSync(0, 'utf8').trim()
    : (secretArg ?? process.env.TELEGRAM_WEBHOOK_SECRET);

if (!secret) {
  console.error('No secret given. Pass it as the second argument, as - to read stdin,\n' +
    'or set TELEGRAM_WEBHOOK_SECRET in .env');
  process.exit(1);
}

const call = async (method, body) => {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const payload = await response.json();
  // Never interpolate the URL into an error -- it carries the token.
  if (!payload.ok) throw new Error(`${method} failed: ${payload.description}`);
  return payload.result;
};

await call('setWebhook', {
  url,
  secret_token: secret,
  // Everything else is noise for this bot.
  allowed_updates: ['message', 'callback_query'],
  drop_pending_updates: true,
});

const info = await call('getWebhookInfo');
console.log('Webhook set. Telegram reports:');
console.log(`  url                  ${info.url}`);
console.log(`  pending_update_count ${info.pending_update_count}`);
console.log(`  has_custom_certificate ${info.has_custom_certificate}`);
if (info.last_error_message) {
  console.log(`  last_error           ${info.last_error_date} ${info.last_error_message}`);
}

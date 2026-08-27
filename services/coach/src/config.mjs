/**
 * Secret resolution for the coach.
 *
 * Two SecureStrings, both created out-of-band and read at runtime (ADR 0004):
 * the bot token, shared with the notifier, and the webhook secret that proves an
 * inbound request really came from Telegram.
 *
 * Same shape as the notifier's config.mjs on purpose -- lazy SSM import so local
 * scripts need no node_modules, and module-scope caching so a warm container
 * does not pay for the lookup twice. The duplication is deliberate: the two
 * services deploy independently and sharing forty lines would mean a Lambda
 * layer, which needs a package.json and reopens ADR 0001.
 */

const cache = new Map();

async function fromSsm(name) {
  if (cache.has(name)) return cache.get(name);

  const { SSMClient, GetParameterCommand } = await import('@aws-sdk/client-ssm');
  const ssm = new SSMClient({});
  const { Parameter } = await ssm.send(
    new GetParameterCommand({ Name: name, WithDecryption: true }),
  );
  if (!Parameter?.Value) throw new Error(`SSM parameter ${name} is empty`);

  cache.set(name, Parameter.Value);
  return Parameter.Value;
}

export async function getBotToken() {
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN;
  const name = process.env.SSM_TOKEN_PARAM;
  if (!name) throw new Error('No bot token: set TELEGRAM_BOT_TOKEN or SSM_TOKEN_PARAM');
  return fromSsm(name);
}

export async function getWebhookSecret() {
  if (process.env.TELEGRAM_WEBHOOK_SECRET) return process.env.TELEGRAM_WEBHOOK_SECRET;
  const name = process.env.SSM_WEBHOOK_SECRET_PARAM;
  if (!name) throw new Error('No webhook secret: set SSM_WEBHOOK_SECRET_PARAM');
  return fromSsm(name);
}

/** The one chat allowed to talk to this bot. Not a secret; it is an env var. */
export function getAllowedChatId() {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) throw new Error('TELEGRAM_CHAT_ID is not set');
  return String(chatId);
}

/** Test hook -- the cache is module scope, which a test must be able to clear. */
export const __clearCache = () => cache.clear();

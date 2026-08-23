/**
 * Configuration and secret resolution.
 *
 * The bot token comes from one of two places:
 *   - TELEGRAM_BOT_TOKEN env var  -> local development, sourced from .env
 *   - SSM Parameter Store         -> on Lambda, a SecureString
 *
 * The SSM client is imported lazily so local runs need no node_modules at all
 * (@aws-sdk/client-ssm ships inside the nodejs22.x runtime, not in our bundle).
 *
 * The resolved token is cached at module scope: Lambda reuses a warm container
 * across invocations, so a scheduled daily run normally costs zero SSM calls
 * after the first.
 */

let cachedToken = null;

export function getChatId() {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) throw new Error('TELEGRAM_CHAT_ID is not set');
  return chatId;
}

export async function getBotToken() {
  if (cachedToken) return cachedToken;

  if (process.env.TELEGRAM_BOT_TOKEN) {
    cachedToken = process.env.TELEGRAM_BOT_TOKEN;
    return cachedToken;
  }

  const name = process.env.SSM_TOKEN_PARAM;
  if (!name) {
    throw new Error(
      'No bot token available: set TELEGRAM_BOT_TOKEN (local) or SSM_TOKEN_PARAM (Lambda)',
    );
  }

  const { SSMClient, GetParameterCommand } = await import('@aws-sdk/client-ssm');
  const ssm = new SSMClient({});
  const { Parameter } = await ssm.send(
    new GetParameterCommand({ Name: name, WithDecryption: true }),
  );

  if (!Parameter?.Value) throw new Error(`SSM parameter ${name} is empty`);

  cachedToken = Parameter.Value;
  return cachedToken;
}

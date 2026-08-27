/**
 * Telegram Bot API client for the coach.
 *
 * A deliberate copy of the notifier's client, not a shared module: the two
 * services are separate nested stacks with their own CodeUri, so sharing would
 * mean a Lambda layer, and a layer needs a package.json for Node to resolve a
 * bare specifier -- which collides with ADR 0001. Sixty lines duplicated is the
 * cheaper trade, and the coach needs methods the notifier never calls.
 *
 * The token is part of the request URL, so errors are built from the method name
 * only -- never from the URL. The token-leak tests apply to this copy too.
 */

const API_ROOT = 'https://api.telegram.org';
const TIMEOUT_MS = 10_000;

export class TelegramError extends Error {
  constructor(method, { status, errorCode, description }) {
    super(`Telegram ${method} failed: ${description ?? `HTTP ${status}`}`);
    this.name = 'TelegramError';
    this.method = method;
    this.status = status;
    this.errorCode = errorCode;
    this.description = description;
  }
}

async function call(token, method, body) {
  let response;
  try {
    response = await fetch(`${API_ROOT}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (cause) {
    throw new TelegramError(method, { description: `network error: ${cause.message}` });
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.ok) {
    throw new TelegramError(method, {
      status: response.status,
      errorCode: payload?.error_code,
      description: payload?.description,
    });
  }

  return payload.result;
}

export const sendMessage = (token, chatId, text, replyMarkup) =>
  call(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });

/**
 * Acknowledge a button press. Telegram shows a spinner on the button until this
 * is called, so skipping it makes a working bot look hung.
 */
export const answerCallbackQuery = (token, callbackQueryId, text) =>
  call(token, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });

/** Resolve a file_id to a download path. The path is valid for about an hour. */
export const getFile = (token, fileId) => call(token, 'getFile', { file_id: fileId });

/** "typing" / "record_voice" indicator, so a slow reply does not look dead. */
export const sendChatAction = (token, chatId, action = 'typing') =>
  call(token, 'sendChatAction', { chat_id: chatId, action });

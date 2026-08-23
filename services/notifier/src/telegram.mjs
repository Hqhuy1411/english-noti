/**
 * Minimal Telegram Bot API client.
 *
 * Zero dependencies: uses the global `fetch` built into Node 18+ (Lambda's
 * nodejs22.x runtime included).
 *
 * The bot token is part of the request URL, so error messages here are built
 * from the method name only -- never from the URL -- to keep the token out of
 * logs and stack traces.
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

/**
 * Call a Bot API method and return its `result` payload.
 * Throws TelegramError on transport failure, non-2xx, or `ok: false`.
 */
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
    // Covers DNS failure, connection reset, and the AbortSignal timeout.
    throw new TelegramError(method, { description: `network error: ${cause.message}` });
  }

  // Telegram returns a JSON body on errors too, so parse before checking status.
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

/** Send a message. Returns the Telegram Message object. */
export const sendMessage = (token, chatId, text) =>
  call(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });

/** Fetch pending updates -- used once at setup time to discover your chat id. */
export const getUpdates = (token) => call(token, 'getUpdates', { limit: 100 });

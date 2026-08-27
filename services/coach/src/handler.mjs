/**
 * Telegram webhook. Receives everything the learner sends back.
 *
 * Three rules shape this file, and all three are easy to get wrong in ways that
 * look like the bot working:
 *
 * 1. **Always answer 200.** Telegram retries any update it does not get a prompt
 *    2xx for, and it retries the same update repeatedly. Returning 401 to a
 *    forged request would earn a retry storm, so a rejected update is logged and
 *    answered 200 with an empty body. The status code is not the security
 *    boundary; the secret check is.
 * 2. **Answer fast.** Telegram's delivery window is short, so this handler does
 *    the cheap part -- authenticate, de-duplicate, record, acknowledge -- and
 *    nothing slow. Transcription and grading arrive in ticket 0004 and run on
 *    their own path.
 * 3. **De-duplicate on update_id.** Because of rule 1's retries, an update can
 *    genuinely arrive twice. Without this, one voice note becomes two
 *    transcription jobs and two replies.
 */

import { getBotToken, getWebhookSecret, getAllowedChatId } from './config.mjs';
import { sendMessage, answerCallbackQuery } from './telegram.mjs';
import { putItem } from './ddb.mjs';
import * as log from './logger.mjs';

const OK = { statusCode: 200, body: '' };
const SECRET_HEADER = 'x-telegram-bot-api-secret-token';
/** Long enough to outlive Telegram's retries, short enough to stay cheap. */
const DEDUPE_TTL_SECONDS = 24 * 60 * 60;

/**
 * Constant-time-ish comparison. Not a defence against a remote timing attack --
 * network jitter dwarfs the signal -- but it costs nothing and avoids the habit
 * of comparing secrets with ===.
 */
function secretMatches(given, expected) {
  if (typeof given !== 'string' || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/** Header names arrive lowercase on HTTP API v2, but do not rely on it. */
const header = (headers, name) => {
  if (!headers) return undefined;
  const hit = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return hit ? headers[hit] : undefined;
};

/** The chat an update came from, whichever shape it has. */
const chatIdOf = (update) =>
  String(update?.message?.chat?.id ?? update?.callback_query?.message?.chat?.id ?? '');

/**
 * Claim this update_id. Returns false if it was already handled.
 * The conditional write is the whole mechanism: two concurrent retries race, and
 * exactly one wins.
 */
async function claim(table, chatId, updateId) {
  try {
    await putItem(
      table,
      {
        PK: `USER#${chatId}`,
        SK: `UPDATE#${updateId}`,
        expiresAt: Math.floor(Date.now() / 1000) + DEDUPE_TTL_SECONDS,
      },
      { condition: 'attribute_not_exists(SK)' },
    );
    return true;
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

export const handler = async (event) => {
  const startedAt = Date.now();

  let expectedSecret;
  try {
    expectedSecret = await getWebhookSecret();
  } catch (err) {
    // Misconfiguration, not an attack. Loud, but still 200 -- a retry will not
    // fix a missing parameter, it will just repeat forever.
    log.error('webhook.misconfigured', { errorName: err.name, errorMessage: err.message });
    return OK;
  }

  if (!secretMatches(header(event.headers, SECRET_HEADER), expectedSecret)) {
    log.warn('webhook.rejected', { reason: 'secret-mismatch', path: event.rawPath });
    return OK;
  }

  let update;
  try {
    update = JSON.parse(event.body ?? '{}');
  } catch {
    log.warn('webhook.rejected', { reason: 'unparseable-body' });
    return OK;
  }

  const chatId = chatIdOf(update);
  if (chatId !== getAllowedChatId()) {
    // A correct secret from an unexpected chat means the bot was added
    // somewhere it should not be, not that the secret leaked.
    log.warn('webhook.rejected', { reason: 'chat-not-allowed' });
    return OK;
  }

  const table = process.env.STUDY_TABLE;
  if (update.update_id != null && table && !(await claim(table, chatId, update.update_id))) {
    log.info('webhook.duplicate', { updateId: update.update_id });
    return OK;
  }

  const token = await getBotToken();

  try {
    if (update.callback_query) {
      await handleButton(token, table, chatId, update.callback_query);
    } else if (update.message?.voice) {
      // Ticket 0004 turns this into a transcription job. Acknowledging now
      // means the learner is never left wondering whether it arrived.
      log.info('submission.voice', {
        updateId: update.update_id,
        durationSeconds: update.message.voice.duration,
      });
      await sendMessage(token, chatId, '🎧 Đã nhận voice note. Chấm bài sẽ có ở bước sau.');
    } else if (update.message?.text) {
      log.info('submission.text', {
        updateId: update.update_id,
        length: update.message.text.length,
      });
      await sendMessage(token, chatId, '📝 Đã nhận bài viết. Chấm bài sẽ có ở bước sau.');
    } else {
      log.info('webhook.ignored', { updateId: update.update_id });
    }
  } catch (err) {
    // A failure here must not become a non-2xx, or Telegram retries an update
    // that has already been recorded as handled.
    log.error('webhook.failed', {
      updateId: update.update_id,
      errorName: err.name,
      errorMessage: err.message,
      description: err.description,
    });
  }

  log.info('webhook.handled', { updateId: update.update_id, durationMs: Date.now() - startedAt });
  return OK;
};

async function handleButton(token, table, chatId, callbackQuery) {
  const action = callbackQuery.data;
  // Always acknowledge first: until this returns, Telegram spins the button.
  await answerCallbackQuery(token, callbackQuery.id);

  const replies = {
    speak: '🎤 Thu một voice note rồi gửi vào đây.',
    write: '📝 Gõ bài viết rồi gửi vào đây.',
    examples: '📖 Thêm ví dụ sẽ có ở bước sau.',
    skip: '😴 Đã ghi nhận. Hẹn tối mai.',
  };

  log.info('button.pressed', { action });
  await sendMessage(token, chatId, replies[action] ?? 'Chưa hiểu nút này.');
}

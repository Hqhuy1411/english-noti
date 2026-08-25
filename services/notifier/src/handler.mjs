/**
 * Lambda entry point, invoked by EventBridge Scheduler at 21:00 Asia/Ho_Chi_Minh.
 *
 * Every invocation emits structured logs so the run can be audited in
 * CloudWatch Logs Insights: one `invocation.start`, then exactly one of
 * `send.success` / `send.failure`.
 *
 * Failures are rethrown on purpose -- that is what marks the Lambda invocation
 * as errored (visible on the Errors metric) and lets the scheduler's retry
 * policy take over.
 */

import { getBotToken, getChatId } from './config.mjs';
import { buildLesson } from './lesson.mjs';
import { sendMessage, TelegramError } from './telegram.mjs';
import * as log from './logger.mjs';

export const handler = async (event, context) => {
  const startedAt = Date.now();
  const requestId = context?.awsRequestId;

  log.info('invocation.start', {
    requestId,
    scheduledTime: event?.time ?? null,
  });

  try {
    const [token, chatId] = [await getBotToken(), getChatId()];
    const lesson = await buildLesson();
    const message = await sendMessage(token, chatId, lesson.text);

    log.info('send.success', {
      requestId,
      chatId,
      messageId: message.message_id,
      durationMs: Date.now() - startedAt,
    });

    return { ok: true, messageId: message.message_id };
  } catch (err) {
    log.error('send.failure', {
      requestId,
      durationMs: Date.now() - startedAt,
      errorName: err.name,
      errorMessage: err.message,
      // Telegram's own explanation of the rejection, when there is one.
      description: err instanceof TelegramError ? err.description : undefined,
      errorCode: err instanceof TelegramError ? err.errorCode : undefined,
      httpStatus: err instanceof TelegramError ? err.status : undefined,
    });
    throw err;
  }
};

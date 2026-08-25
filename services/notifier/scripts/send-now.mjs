/**
 * Send the reminder right now, straight from your machine.
 *
 * This is the local gate: it proves the token, the chat id and the message
 * builder all work before any AWS resource exists. It talks to Telegram only --
 * no AWS credentials needed.
 *
 * Usage:  node services/notifier/scripts/send-now.mjs
 */

import { buildLesson } from '../src/lesson.mjs';
import { sendMessage } from '../src/telegram.mjs';
import { loadEnv } from './load-env.mjs';

loadEnv();

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

if (!token || !chatId) {
  console.error(
    'Missing config. Need TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env\n' +
      '(run get-chat-id.mjs to find your chat id).',
  );
  process.exit(1);
}

const lesson = await buildLesson();
const message = await sendMessage(token, chatId, lesson.text);
console.log(`Sent. message_id=${message.message_id} chat_id=${chatId}`);

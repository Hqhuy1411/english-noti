/**
 * One-time setup helper: discover your Telegram chat id.
 *
 * Prerequisite: you must have sent at least one message to your bot. Telegram
 * only exposes a chat through getUpdates once that chat has messaged the bot,
 * and a bot can never initiate a conversation first.
 *
 * Usage:  node services/notifier/scripts/get-chat-id.mjs
 */

import { getUpdates } from '../src/telegram.mjs';
import { loadEnv } from './load-env.mjs';

loadEnv();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const updates = await getUpdates(token);

if (updates.length === 0) {
  console.error(
    'No updates found.\n' +
      'Open Telegram, send any message to your bot, then run this again.\n' +
      '(If you already did: a previous getUpdates call may have consumed them -- ' +
      'send one more message and retry.)',
  );
  process.exit(1);
}

// Collapse to unique chats -- there is normally exactly one (you).
const chats = new Map();
for (const u of updates) {
  const chat = u.message?.chat ?? u.edited_message?.chat;
  if (chat) chats.set(chat.id, chat);
}

console.log('Found chat(s):\n');
for (const chat of chats.values()) {
  const who = [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.title || '(no name)';
  console.log(`  TELEGRAM_CHAT_ID=${chat.id}   # ${chat.type}: ${who}`);
}
console.log('\nAdd the line above to your .env file.');

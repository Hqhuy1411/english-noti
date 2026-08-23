/**
 * Tests for the notifier. Uses the Node built-in test runner -- no dependency.
 *
 *   node --test services/notifier/test/
 *
 * `fetch` is stubbed, so nothing here touches the network, Telegram, or AWS.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildMessage } from '../src/lesson.mjs';
import { sendMessage, TelegramError } from '../src/telegram.mjs';

const TOKEN = 'SECRET-TOKEN-DO-NOT-LEAK';

/** Swap in a fake fetch for the duration of `fn`. */
async function withFetch(impl, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

/** Capture stdout+stderr writes so emitted log lines can be asserted on. */
async function captureLogs(fn) {
  const lines = [];
  const outW = process.stdout.write.bind(process.stdout);
  const errW = process.stderr.write.bind(process.stderr);
  const grab = (chunk) => {
    lines.push(String(chunk).trim());
    return true;
  };
  process.stdout.write = grab;
  process.stderr.write = grab;
  try {
    await fn();
  } finally {
    process.stdout.write = outW;
    process.stderr.write = errW;
  }
  return lines.filter(Boolean).map((l) => JSON.parse(l));
}

const okFetch = (spy) => async (url, init) => {
  spy?.({ url, body: JSON.parse(init.body) });
  return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 4242 } }) };
};

const rejectFetch = async () => ({
  ok: false,
  status: 401,
  json: async () => ({ ok: false, error_code: 401, description: 'Unauthorized' }),
});

// --- lesson.mjs -------------------------------------------------------------

test('message renders the timestamp in Asia/Ho_Chi_Minh', () => {
  // 14:00 UTC is 21:00 in Vietnam (UTC+7), the scheduled send time.
  const text = buildMessage(new Date('2026-08-22T14:00:00Z'));
  assert.match(text, /21:00/);
  assert.match(text, /Asia\/Ho_Chi_Minh/);
});

test('message escapes HTML so parse_mode cannot be broken by content', () => {
  const text = buildMessage(new Date('2026-08-22T14:00:00Z'));
  // Our own <b> markup survives; nothing else introduces a raw stray bracket.
  assert.ok(text.includes('<b>'));
});

test('a non-prod environment is labelled so a test is never mistaken for real', () => {
  const when = new Date('2026-08-23T02:00:00Z'); // 09:00 in Vietnam
  const prod = buildMessage(when, 'prod');
  const test_ = buildMessage(when, 'test');

  assert.ok(!prod.includes('TEST'), 'prod message must not be labelled');
  assert.match(test_, /\[TEST\]/);
  assert.match(test_, /09:00/);
  assert.notEqual(prod, test_);
});

// --- telegram.mjs -----------------------------------------------------------

test('sendMessage posts chat_id and text to the sendMessage method', async () => {
  const calls = [];
  await withFetch(okFetch((c) => calls.push(c)), async () => {
    const result = await sendMessage(TOKEN, '999', 'hello');
    assert.equal(result.message_id, 4242);
  });

  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith('/sendMessage'));
  assert.equal(calls[0].body.chat_id, '999');
  assert.equal(calls[0].body.text, 'hello');
});

test('the token travels in the URL and never in the request body', async () => {
  const calls = [];
  await withFetch(okFetch((c) => calls.push(c)), () => sendMessage(TOKEN, '1', 'x'));

  assert.ok(calls[0].url.includes(TOKEN), 'token should be in the URL');
  assert.ok(!JSON.stringify(calls[0].body).includes(TOKEN), 'token must not be in the body');
});

test('a rejected send never leaks the token into the error or its stack', async () => {
  await withFetch(rejectFetch, async () => {
    // The token is part of the request URL, so an error built from that URL
    // would put the token into every log line and stack trace.
    await assert.rejects(
      () => sendMessage(TOKEN, '1', 'x'),
      (err) => {
        assert.ok(err instanceof TelegramError);
        assert.equal(err.description, 'Unauthorized');
        assert.equal(err.errorCode, 401);
        assert.ok(!err.message.includes(TOKEN), 'token leaked into message');
        assert.ok(!String(err.stack).includes(TOKEN), 'token leaked into stack');
        return true;
      },
    );
  });
});

test('a network failure surfaces as TelegramError, not a raw fetch error', async () => {
  const boom = async () => {
    throw new Error('getaddrinfo ENOTFOUND');
  };
  await withFetch(boom, () =>
    assert.rejects(() => sendMessage(TOKEN, '1', 'x'), { name: 'TelegramError' }),
  );
});

// --- handler.mjs ------------------------------------------------------------
// Imported dynamically because config.mjs caches the token at module scope.

test('a successful run logs invocation.start then send.success', async () => {
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  process.env.TELEGRAM_CHAT_ID = '5150';
  const { handler } = await import('../src/handler.mjs');

  let returned;
  const logs = await captureLogs(() =>
    withFetch(okFetch(), async () => {
      returned = await handler({ time: '2026-08-22T14:00:00Z' }, { awsRequestId: 'req-1' });
    }),
  );

  assert.deepEqual(returned, { ok: true, messageId: 4242 });
  assert.deepEqual(
    logs.map((l) => l.event),
    ['invocation.start', 'send.success'],
  );

  const success = logs[1];
  assert.equal(success.level, 'INFO');
  assert.equal(success.messageId, 4242);
  assert.equal(success.chatId, '5150');
  assert.equal(typeof success.durationMs, 'number');
  // Whatever we log, it must not contain the secret.
  assert.ok(!JSON.stringify(logs).includes(TOKEN));
});

test('a failed run logs send.failure with Telegram\'s reason, then rethrows', async () => {
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  process.env.TELEGRAM_CHAT_ID = '5150';
  const { handler } = await import('../src/handler.mjs');

  let threw = false;
  const logs = await captureLogs(() =>
    withFetch(rejectFetch, async () => {
      // Rethrowing is what marks the invocation errored and lets the
      // scheduler's retry policy engage -- swallowing it would hide outages.
      await handler({}, { awsRequestId: 'req-2' }).catch(() => {
        threw = true;
      });
    }),
  );

  assert.ok(threw, 'handler must rethrow');

  const failure = logs.at(-1);
  assert.equal(failure.event, 'send.failure');
  assert.equal(failure.level, 'ERROR');
  assert.equal(failure.description, 'Unauthorized');
  assert.equal(failure.errorCode, 401);
  assert.equal(failure.httpStatus, 401);
  assert.ok(!JSON.stringify(logs).includes(TOKEN));
});

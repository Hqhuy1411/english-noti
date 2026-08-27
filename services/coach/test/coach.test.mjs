/**
 * Webhook tests. No AWS, no network: fetch is stubbed and DynamoDB is reached
 * only when STUDY_TABLE is set, which these tests mostly leave unset.
 *
 * The behaviours asserted here are the ones whose failure looks like success:
 * a forged request that gets processed, a retry that doubles a submission, a
 * rejection that returns a status Telegram will retry forever.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const SECRET = 'test-secret-value';
const CHAT = '123456789';

process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_CHAT_ID = CHAT;
delete process.env.STUDY_TABLE;

const { handler } = await import('../src/handler.mjs');

/** Stub fetch, capture the calls, restore afterwards. */
async function withFetch(fn) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init?.body ?? '{}') });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    return { result: await fn(), calls };
  } finally {
    globalThis.fetch = original;
  }
}

async function captureLogs(fn) {
  const written = [];
  const out = process.stdout.write;
  const err = process.stderr.write;
  process.stdout.write = (c) => (written.push(String(c)), true);
  process.stderr.write = (c) => (written.push(String(c)), true);
  try {
    return { result: await fn(), logs: written.join('') };
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
}

const request = (update, { secret = SECRET } = {}) => ({
  rawPath: '/telegram',
  headers: { 'x-telegram-bot-api-secret-token': secret },
  body: JSON.stringify(update),
});

const textUpdate = (overrides = {}) => ({
  update_id: 1,
  message: { chat: { id: Number(CHAT) }, text: 'I pushed back on the deadline.' },
  ...overrides,
});

test('a request with the wrong secret is rejected and never acted on', async () => {
  const { result, logs } = await captureLogs(() =>
    withFetch(() => handler(request(textUpdate(), { secret: 'wrong' }))).then((r) => {
      assert.deepEqual(r.calls, [], 'a forged update must not reach Telegram');
      return r.result;
    }),
  );
  assert.equal(result.statusCode, 200);
  assert.match(logs, /webhook\.rejected/);
  assert.match(logs, /secret-mismatch/);
});

test('a request with no secret header at all is rejected', async () => {
  const { result } = await withFetch(() =>
    handler({ rawPath: '/telegram', headers: {}, body: JSON.stringify(textUpdate()) }),
  );
  assert.equal(result.statusCode, 200);
});

test('a rejected request still answers 200, or Telegram retries it forever', async () => {
  for (const bad of [
    request(textUpdate(), { secret: 'wrong' }),
    { rawPath: '/telegram', headers: { 'x-telegram-bot-api-secret-token': SECRET }, body: '{not json' },
    request({ update_id: 2, message: { chat: { id: 999 }, text: 'hi' } }),
  ]) {
    const { result } = await withFetch(() => handler(bad));
    assert.equal(result.statusCode, 200, 'every rejection path must be 200');
  }
});

test('a correct secret from an unexpected chat is still refused', async () => {
  const { logs } = await captureLogs(() =>
    withFetch(() => handler(request({ update_id: 3, message: { chat: { id: 999 }, text: 'hi' } }))),
  );
  assert.match(logs, /chat-not-allowed/);
});

test('the secret header is matched case-insensitively, as HTTP allows', async () => {
  const { calls } = await withFetch(() =>
    handler({
      rawPath: '/telegram',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': SECRET },
      body: JSON.stringify(textUpdate()),
    }),
  );
  assert.equal(calls.length, 1, 'a valid update should have been acted on');
});

test('a written answer is acknowledged', async () => {
  const { calls } = await withFetch(() => handler(request(textUpdate())));
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/sendMessage$/);
  assert.equal(calls[0].body.chat_id, CHAT);
  assert.match(calls[0].body.text, /Đã nhận bài viết/);
});

test('a voice note is acknowledged, so it is never silently swallowed', async () => {
  const update = {
    update_id: 4,
    message: { chat: { id: Number(CHAT) }, voice: { file_id: 'abc', duration: 42 } },
  };
  const { result } = await captureLogs(() => withFetch(() => handler(request(update))));
  assert.match(result.calls[0].body.text, /Đã nhận voice note/);
});

test('a button press is acknowledged before anything else, or it spins', async () => {
  const update = {
    update_id: 5,
    callback_query: { id: 'cb1', data: 'speak', message: { chat: { id: Number(CHAT) } } },
  };
  const { calls } = await withFetch(() => handler(request(update)));
  assert.match(calls[0].url, /answerCallbackQuery$/, 'acknowledge first');
  assert.match(calls[1].body.text, /voice note/);
});

test('an unknown button does not throw, it says so', async () => {
  const update = {
    update_id: 6,
    callback_query: { id: 'cb2', data: 'nonsense', message: { chat: { id: Number(CHAT) } } },
  };
  const { calls } = await withFetch(() => handler(request(update)));
  assert.match(calls[1].body.text, /Chưa hiểu nút này/);
});

test('a Telegram failure is logged but still answers 200', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ ok: false, error_code: 403, description: 'bot was blocked' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  try {
    const { result, logs } = await captureLogs(() => handler(request(textUpdate())));
    assert.equal(result.statusCode, 200);
    assert.match(logs, /webhook\.failed/);
    assert.match(logs, /bot was blocked/);
  } finally {
    globalThis.fetch = original;
  }
});

test('no log line ever carries the bot token', async () => {
  const { logs } = await captureLogs(() => withFetch(() => handler(request(textUpdate()))));
  assert.ok(!logs.includes('test-token'), 'the token reached a log line');
});

/**
 * The lesson seam (ADR 0009). These run with no AWS credentials and no
 * node_modules, which is itself part of what is being tested: the fallback path
 * has to work when DynamoDB is not reachable, and locally it never is.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildLesson } from '../src/lesson.mjs';

const curriculum = JSON.parse(
  await readFile(new URL('../src/study/curriculum.json', import.meta.url), 'utf8'),
).items;

/**
 * Silence the log line the fallback path emits, and hand back what it said.
 * logger.mjs sends WARN to stdout -- only ERROR goes to stderr.
 */
async function captureLogs(fn) {
  const written = [];
  const outWrite = process.stdout.write;
  const errWrite = process.stderr.write;
  process.stdout.write = (chunk) => (written.push(String(chunk)), true);
  process.stderr.write = (chunk) => (written.push(String(chunk)), true);
  try {
    return { result: await fn(), logs: written.join('') };
  } finally {
    process.stdout.write = outWrite;
    process.stderr.write = errWrite;
  }
}

const WED = new Date('2026-08-26T14:00:00Z'); // Wednesday 21:00 in Vietnam
const TUE = new Date('2026-08-25T14:00:00Z'); // Tuesday 21:00 in Vietnam

test('the message carries real vocabulary, not a placeholder', async () => {
  const { text } = await buildLesson({ now: WED, table: null });

  const words = curriculum.filter((item) => text.includes(item.word));
  assert.ok(words.length >= 1, 'no curriculum word appeared in the message');
  // The old Phase 1 placeholder must be gone for good.
  assert.doesNotMatch(text, /Phase 2/);
});

test('a lesson always includes something to say out loud', async () => {
  const { text } = await buildLesson({ now: WED, table: null });
  assert.match(text, /🎤 Nói/);
});

test('the [TEST] label survives the real content', async () => {
  const { text } = await buildLesson({ now: WED, environment: 'test', table: null });
  assert.match(text, /\[TEST\]/);
  const words = curriculum.filter((item) => text.includes(item.word));
  assert.ok(words.length >= 1, 'a test message should carry real content too');
});

test('a test firing files its lesson under a separate key from prod', async () => {
  const prod = await buildLesson({ now: WED, environment: 'prod', table: null });
  const testEnv = await buildLesson({ now: WED, environment: 'test', table: null });

  assert.equal(prod.lessonId, 'LESSON#2026-08-26');
  assert.equal(testEnv.lessonId, 'LESSON#2026-08-26#test');
  assert.notEqual(prod.lessonId, testEnv.lessonId);
});

test('two consecutive days do not send the same message', async () => {
  const tue = await buildLesson({ now: TUE, table: null });
  const wed = await buildLesson({ now: WED, table: null });
  assert.notEqual(tue.text, wed.text);
});

test('a send still happens when the state store is unreachable', async () => {
  // A table name is configured but the SDK/table is not available -- exactly the
  // shape of a real outage, and the reason ADR 0009 forbids a content failure
  // from becoming a send failure.
  const { result, logs } = await captureLogs(() =>
    buildLesson({ now: WED, table: 'no-such-table', chatId: '123456' }),
  );

  assert.ok(result.text.length > 0, 'a message must still be produced');
  const words = curriculum.filter((item) => result.text.includes(item.word));
  assert.ok(words.length >= 1, 'the fallback must still carry real vocabulary');
  assert.match(logs, /lesson\.state\.unavailable/, 'the failure must be logged, not hidden');
});

test('curriculum content is escaped, so a stray bracket cannot break parse_mode', async () => {
  const { text } = await buildLesson({ now: WED, table: null });
  // Our own markup is the only source of tags; strip it and nothing raw is left.
  const stripped = text.replaceAll(/<\/?(b|i)>/g, '');
  assert.doesNotMatch(stripped, /[<>]/);
});

test('writing appears on a writing day and not on the days between', async () => {
  const wed = await buildLesson({ now: WED, table: null });
  const tue = await buildLesson({ now: TUE, table: null });
  assert.match(wed.text, /📝 Viết/);
  assert.doesNotMatch(tue.text, /📝 Viết/);
});

test('the seam returns the shape ADR 0009 specifies', async () => {
  const lesson = await buildLesson({ now: WED, table: null });
  assert.deepEqual(Object.keys(lesson).sort(), ['lessonId', 'replyMarkup', 'text']);
});

test('the lesson carries buttons whose callback data the coach actually handles', async () => {
  const { replyMarkup } = await buildLesson({ now: WED, table: null });
  const actions = replyMarkup.inline_keyboard.flat().map((b) => b.callback_data);

  // These strings are a wire contract with services/coach/src/handler.mjs.
  // Renaming one here without renaming it there produces a button that answers
  // "Chưa hiểu nút này" -- a bug that only shows up on a phone.
  assert.deepEqual(actions.sort(), ['examples', 'skip', 'speak', 'write']);
});

test('the write button only appears on a day there is writing to do', async () => {
  const wed = await buildLesson({ now: WED, table: null });
  const tue = await buildLesson({ now: TUE, table: null });
  const has = (l) => l.replyMarkup.inline_keyboard.flat().some((b) => b.callback_data === 'write');

  assert.ok(has(wed), 'Wednesday is a writing day');
  assert.ok(!has(tue), 'Tuesday is not');
});

test('a technical concept is set as something to explain, not a sentence to read', async () => {
  const tech = curriculum.filter((i) => i.tags.includes('tech'));
  assert.ok(tech.length > 0, 'no tech items in the curriculum');

  // Drive the selector straight at a tech item rather than waiting for the
  // rotation to land on one.
  const { text } = await buildLesson({
    now: new Date('2026-08-26T14:00:00Z'),
    table: null,
    curriculum: tech,
  });

  assert.match(text, /Giải thích/);
  assert.doesNotMatch(text, /Đọc to câu này/);
});

test('technical shadow sentences spell acronyms out, so they can be said aloud', async () => {
  for (const item of curriculum.filter((i) => i.tags.includes('tech'))) {
    assert.doesNotMatch(item.shadowSentence, /\b[A-Z]{2,}\b/, `${item.id}: unsayable acronym`);
  }
});

test('a speaking task ships with a shape to follow, not just a prompt', async () => {
  const { text } = await buildLesson({
    now: new Date('2026-08-26T14:00:00Z'),
    table: null,
    curriculum: curriculum.filter((i) => i.tags.includes('tech')),
  });

  assert.match(text, /Gợi ý/);
  assert.match(text, /The problem it solves is/, 'model phrases should be there to borrow');
  assert.match(text, /Cụm cần dùng cho được/, 'and the words to actually land');
});

test('the scaffolding can be switched off without touching the lesson', async () => {
  const args = {
    now: new Date('2026-08-26T14:00:00Z'),
    table: null,
    curriculum: curriculum.filter((i) => i.tags.includes('tech')),
  };
  const on = await buildLesson({ ...args, speakingHints: true });
  const off = await buildLesson({ ...args, speakingHints: false });

  assert.doesNotMatch(off.text, /Gợi ý/);
  // The lesson itself is untouched -- only the scaffolding goes.
  assert.match(off.text, /🎤 Nói/);
  assert.ok(off.text.length < on.text.length);
});

test('SPEAKING_HINTS=off is honoured from the environment', async () => {
  const previous = process.env.SPEAKING_HINTS;
  process.env.SPEAKING_HINTS = 'off';
  try {
    const { text } = await buildLesson({ now: new Date('2026-08-26T14:00:00Z'), table: null });
    assert.doesNotMatch(text, /Gợi ý/);
  } finally {
    if (previous === undefined) delete process.env.SPEAKING_HINTS;
    else process.env.SPEAKING_HINTS = previous;
  }
});

test('reading a given sentence aloud gets no scaffolding, since there is nothing to invent', async () => {
  // Force a shadow task by handing the selector a single non-tech item.
  const one = curriculum.find((i) => !i.tags.includes('tech') && !i.tags.includes('pronunciation'));
  let sawShadow = false;
  for (const day of ['2026-08-24', '2026-08-25', '2026-08-26']) {
    const { text } = await buildLesson({
      now: new Date(`${day}T14:00:00Z`),
      table: null,
      curriculum: [one],
    });
    if (/Đọc to câu này/.test(text)) {
      sawShadow = true;
      assert.doesNotMatch(text, /Gợi ý — nói theo thứ tự/);
    }
  }
  assert.ok(sawShadow, 'the rotation never produced a shadow task to check');
});

test('an unfamiliar concept has a way in, offered after the attempt not before', async () => {
  const tech = curriculum.filter((i) => i.tags.includes('tech'));
  const { text } = await buildLesson({
    now: new Date('2026-08-26T14:00:00Z'),
    table: null,
    curriculum: tech,
  });

  assert.match(text, /Chưa quen khái niệm này/);

  // Order matters: the prompt has to come first, or the primer hands over the
  // answer before the learner has tried.
  assert.ok(
    text.indexOf('🎤 Nói') < text.indexOf('Chưa quen khái niệm này'),
    'the primer must sit below the speaking task, not above it',
  );
});

test('every technical item carries a primer, so none of them is a dead end', () => {
  const missing = curriculum
    .filter((i) => i.tags.includes('tech'))
    .filter((i) => typeof i.brief !== 'string' || i.brief.trim() === '')
    .map((i) => i.id);
  assert.deepEqual(missing, [], `tech items with no brief: ${missing.join(', ')}`);
});

test('a primer is plain prose -- it renders into a Telegram message unescaped otherwise', () => {
  for (const item of curriculum.filter((i) => i.brief)) {
    assert.doesNotMatch(item.brief, /\n/, `${item.id}: newline in brief`);
    assert.doesNotMatch(item.brief, /[*_`#]/, `${item.id}: markdown character in brief`);
  }
});

test('non-technical tasks get no primer, because there is no concept to learn', async () => {
  const daily = curriculum.filter((i) => i.tags.includes('daily'));
  const { text } = await buildLesson({
    now: new Date('2026-08-26T14:00:00Z'),
    table: null,
    curriculum: daily,
  });
  assert.doesNotMatch(text, /Chưa quen khái niệm này/);
});

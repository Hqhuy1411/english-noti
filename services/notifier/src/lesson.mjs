/**
 * PHASE 2 SEAM: builds the lesson that goes out at 21:00.
 *
 * The contract is set by ADR 0009, which supersedes ADR 0007: this is async now,
 * and it returns an object rather than a string, so the inline keyboard the
 * coach service needs has somewhere to live. handler.mjs awaits it; nothing else
 * in the notifier knows this file talks to DynamoDB.
 *
 * The rule that shapes everything here: **a send must never fail because a
 * content source did.** Phase 1 bought a punctual, reliable 21:00 message, and
 * that is not traded for richer content. Every path through this file ends in a
 * message -- if the table is unreachable, misconfigured, or simply not there
 * yet, the curriculum committed next door is picked from deterministically and
 * the reminder still arrives. The failure is logged, not propagated.
 *
 * What this file must NOT do (ADR 0010, .claude/rules/study-data.md): advance an
 * item's SRS box. Choosing a word for today is not evidence the learner said it.
 * Boxes move only on the grading path, after a submission.
 */

import { readFileSync } from 'node:fs';
import * as log from './logger.mjs';
import { query, putItem } from './study/ddb.mjs';
import { selectLesson, newItem, isoDate } from './study/srs.mjs';

const TZ = 'Asia/Ho_Chi_Minh';

const allItems = JSON.parse(
  readFileSync(new URL('./study/curriculum.json', import.meta.url), 'utf8'),
).items;

const vnDateTime = (now) =>
  new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, dateStyle: 'full', timeStyle: 'short' }).format(now);

/** Escape the three characters that matter for Telegram's HTML parse_mode. */
const esc = (s) =>
  String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** Monday=1 … Sunday=7, in Vietnam. */
const vnWeekday = (now) =>
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(now),
  );

/** Writing lands on Monday, Wednesday and Friday -- often enough to matter, rare enough to do. */
const isWritingDay = (now) => [1, 3, 5].includes(vnWeekday(now));

const TASK_TYPES = ['shadow', 'answer', 'roleplay'];

/**
 * Scaffolding for the speaking task.
 *
 * A prompt on its own is not enough: being asked to talk for sixty seconds with
 * nothing to hold onto is how a session ends in silence. Each task type gets a
 * shape to follow and a few English phrases to reach for, plus the item's own
 * collocations as the words to actually land.
 *
 * These are deliberately generic rather than authored per item. They are derived
 * from data the curriculum already carries, so all 93 items got them at once, and
 * a structure is what unblocks someone -- not a script.
 *
 * Switched off with SPEAKING_HINTS=off once they are no longer needed. That is a
 * stack Parameter as well as an env var, per ADR 0006: a knob you would edit a
 * file to change does not get changed.
 */
const HINTS = {
  explain: {
    shape: [
      'Vấn đề nó giải quyết là gì?',
      'Nó chạy thế nào — một câu thôi',
      'Đánh đổi là gì?',
      'Chỗ làm bạn dùng nó ở đâu?',
    ],
    phrases: [
      'The problem it solves is…',
      'Under the hood it…',
      'The trade-off is that…',
      'In our case we use it for…',
    ],
  },
  roleplay: {
    shape: [
      'Tình hình: chuyện gì đang xảy ra',
      'Ảnh hưởng: nó chặn ai, trễ cái gì',
      'Bạn đang làm gì để xử lý',
      'Bạn cần gì từ team',
    ],
    phrases: [
      'Quick update on…',
      'We are blocked on…',
      'The impact is that…',
      'What I need from you is…',
    ],
  },
  answer: {
    shape: [
      'Chuyện xảy ra khi nào, ở đâu',
      'Bạn đã làm gì',
      'Kết quả ra sao',
      'Lần sau bạn sẽ làm khác chỗ nào',
    ],
    phrases: [
      'This happened a couple of weeks ago…',
      'What I ended up doing was…',
      'In the end…',
      'Looking back, I would…',
    ],
  },
};

/** Words the learner should actually land, drawn from the items in play. */
const keywordsFrom = (items) =>
  [...new Set(items.flatMap((i) => i.collocations.slice(0, 2)))].slice(0, 5);

function renderHints(task, focusPool) {
  const hint = HINTS[task.type];
  if (!hint) {
    // `shadow` needs no scaffolding -- the sentence is already given. A
    // pronunciation item gets a note on what is actually being listened for.
    const focus = focusPool[0];
    return focus?.tags.includes('pronunciation')
      ? ['', '<i>Đọc chậm, rõ âm cuối. Máy nghe nhầm chỗ nào thì đó là chỗ cần sửa.</i>']
      : [];
  }

  return [
    '',
    '<b>💡 Gợi ý — nói theo thứ tự này</b>',
    ...hint.shape.map((line, i) => `${i + 1}. ${esc(line)}`),
    '',
    '<b>Mẫu câu</b>',
    ...hint.phrases.map((phrase) => `· <i>${esc(phrase)}</i>`),
    '',
    `<b>Cụm cần dùng cho được:</b> ${esc(keywordsFrom(focusPool).join(' · '))}`,
  ];
}


/**
 * Which speaking task today. Deterministic from the date so it rotates without
 * needing stored state, and so a test firing on the same day is reproducible.
 */
function pickTask(today, mode, items) {
  // Coming back from a gap should be easy: reading one sentence aloud, nothing
  // that demands composing an answer.
  const type = mode === 'gentle-return' ? 'shadow' : TASK_TYPES[dayIndex(today) % TASK_TYPES.length];
  const focus = items[dayIndex(today) % Math.max(1, items.length)];

  if (!focus) return { type: 'shadow', prompt: 'Đọc to câu bất kỳ ở trên.', expectedText: null };

  // A technical concept is not vocabulary to be used in a sentence -- the
  // learner already knows what MVCC is. What they cannot do is explain it out
  // loud in English in a design review, so that is the exercise.
  if (focus.tags.includes('tech')) {
    return {
      type: 'explain',
      prompt: `Giải thích "${focus.word}" trong 60 giây bằng tiếng Anh, như đang nói với một đồng nghiệp mới vào team. Đừng đọc định nghĩa — nói như trong design review.`,
      expectedText: null,
    };
  }

  if (type === 'shadow') {
    return {
      type,
      prompt: 'Đọc to câu này, tốc độ tự nhiên, thu một voice note:',
      expectedText: focus.shadowSentence,
    };
  }
  if (type === 'answer') {
    return {
      type,
      prompt: `Trả lời 45–60 giây, dùng ít nhất hai từ ở trên (bắt buộc có "${focus.word}"): Kể về một lần gần đây bạn phải ${focus.word} ở chỗ làm.`,
      expectedText: null,
    };
  }
  return {
    type,
    prompt: `Đóng vai 60 giây: bạn đang ở standup và cần dùng "${focus.word}" để giải thích tình hình cho team.`,
    expectedText: null,
  };
}

const dayIndex = (today) => Math.floor(Date.parse(`${today}T00:00:00Z`) / 86_400_000);

/** Read this learner's SRS items. Returns [] on any failure -- the caller falls back. */
async function loadDueItems(table, chatId, today) {
  return query(table, {
    indexName: 'GSI1',
    keyCondition: 'GSI1PK = :pk AND GSI1SK <= :today',
    expressionValues: { ':pk': `USER#${chatId}#DUE`, ':today': today },
    limit: 100,
  });
}

function renderWord(item, index) {
  return [
    `${index}. <b>${esc(item.word)}</b> — <i>${esc(item.viGloss)}</i>`,
    `   ${esc(item.collocations.slice(0, 2).join(' · '))}`,
    `   “${esc(item.example)}”`,
  ].join('\n');
}

function render({ now, environment, mode, review, fresh, task, writing, hints = [] }) {
  const isProd = environment === 'prod';
  const lines = [];

  lines.push(
    isProd
      ? '<b>🇬🇧 Đã tới giờ học tiếng Anh!</b>'
      : `<b>🧪 [${esc(environment.toUpperCase())}] Test thông báo học tiếng Anh</b>`,
  );
  lines.push('', `🕘 ${esc(vnDateTime(now))} (${TZ})`, '');

  if (mode === 'gentle-return') {
    lines.push('<i>Chào mừng quay lại. Hôm nay nhẹ thôi: chỉ ôn, không từ mới.</i>', '');
  } else if (mode === 'first-run') {
    lines.push('<i>Buổi đầu tiên. Bắt đầu từ những cụm dùng được ngay ở chỗ làm.</i>', '');
  }

  if (review.length) {
    lines.push('<b>🔁 Ôn lại</b>');
    review.forEach((item, i) => lines.push(renderWord(item, i + 1)));
    lines.push('');
  }

  if (fresh.length) {
    lines.push('<b>✨ Từ mới hôm nay</b>');
    fresh.forEach((item, i) => lines.push(renderWord(item, review.length + i + 1)));
    lines.push('');
  }

  lines.push('<b>🎤 Nói</b>', esc(task.prompt));
  if (task.expectedText) lines.push('', `<b>“${esc(task.expectedText)}”</b>`);
  lines.push(...hints);

  if (writing) {
    lines.push('', '<b>📝 Viết</b>', esc(writing));
  }

  if (!isProd) {
    lines.push('', '<i>Đây là tin nhắn test — không phải nhắc nhở thật.</i>');
  }

  return lines.join('\n');
}

/**
 * Build today's lesson.
 *
 * @returns `{ text, replyMarkup, lessonId }`. `replyMarkup` is null until the
 *          coach service exists to receive button presses (ticket 0003).
 */
export async function buildLesson({
  now = new Date(),
  environment = process.env.ENVIRONMENT ?? 'prod',
  table = process.env.STUDY_TABLE,
  chatId = process.env.TELEGRAM_CHAT_ID,
  curriculum = allItems,
  speakingHints = (process.env.SPEAKING_HINTS ?? 'on') !== 'off',
} = {}) {
  const byId = new Map(curriculum.map((item) => [item.id, item]));
  const today = isoDate(now, TZ);
  const isProd = environment === 'prod';
  // ADR 0010: a test firing must never overwrite the record a real submission
  // will be graded against.
  const lessonId = isProd ? `LESSON#${today}` : `LESSON#${today}#${environment}`;

  let items = [];
  let lastLessonDate = null;
  let stateful = false;

  if (table && chatId) {
    try {
      items = (await loadDueItems(table, chatId, today)).map((row) => ({
        wordId: row.wordId,
        box: row.box,
        dueOn: row.dueOn,
      }));
      lastLessonDate = null; // filled in below only if the write succeeds
      stateful = true;
    } catch (err) {
      // Deliberately swallowed: a content failure must not become a send failure.
      log.warn('lesson.state.unavailable', { errorName: err.name, errorMessage: err.message });
    }
  }

  const plan = selectLesson({ today, items, curriculum, lastLessonDate });

  const review = plan.reviewIds.map((id) => byId.get(id)).filter(Boolean);
  const fresh = plan.newIds.map((id) => byId.get(id)).filter(Boolean);
  const focusPool = [...fresh, ...review];
  const task = pickTask(today, plan.mode, focusPool);
  const writing =
    isWritingDay(now) && plan.mode !== 'gentle-return' && focusPool.length
      ? `Viết 4–6 câu về một tình huống ở chỗ làm, dùng ít nhất ba cụm ở trên.`
      : null;

  const hints = speakingHints ? renderHints(task, focusPool) : [];
  const text = render({ now, environment, mode: plan.mode, review, fresh, task, writing, hints });

  if (stateful) {
    try {
      // Introducing a word creates its record at box 0. That is not advancing a
      // box -- nothing here touches an existing item's box (ADR 0010).
      for (const item of fresh) {
        await putItem(table, {
          PK: `USER#${chatId}`,
          SK: `ITEM#${item.id}`,
          GSI1PK: `USER#${chatId}#DUE`,
          GSI1SK: today,
          ...newItem(item.id, today),
        });
      }
      await putItem(table, {
        PK: `USER#${chatId}`,
        SK: lessonId,
        date: today,
        environment,
        mode: plan.mode,
        reviewIds: plan.reviewIds,
        newIds: plan.newIds,
        taskType: task.type,
        prompt: task.prompt,
        expectedText: task.expectedText,
      });
    } catch (err) {
      log.warn('lesson.state.write-failed', { errorName: err.name, errorMessage: err.message });
    }
  }

  return { text, replyMarkup: null, lessonId };
}

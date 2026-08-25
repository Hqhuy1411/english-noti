/**
 * Spaced-repetition selection. Pure functions only -- no I/O, no clock, no AWS.
 *
 * Everything here takes data in and returns a decision, so the rules that are
 * easy to get wrong (the daily cap, the return-after-a-gap behaviour, and when a
 * box is allowed to advance) can be tested with `node --test` and no credentials.
 *
 * The one rule worth stating in code as well as in ADR 0010: selecting a word
 * into a lesson must never advance its box. Nothing in this file writes to
 * `box` except `gradeItem`, which is only ever called from the grading path
 * after a submission confirmed the word was actually spoken.
 */

/** Leitner intervals in days, indexed by box. Box 5 is "mastered, check monthly". */
const INTERVALS = [1, 2, 4, 8, 16, 32];

export const MAX_REVIEW_PER_DAY = 6;
export const NEW_WORDS_PER_DAY = 3;
/** More than this many days away and the returning lesson is review-only. */
export const GAP_DAYS_FOR_LIGHT_RETURN = 3;

/** `YYYY-MM-DD` for a Date, in the given IANA zone. Pure: the Date is the input. */
export function isoDate(date, timeZone = 'Asia/Ho_Chi_Minh') {
  // en-CA formats as YYYY-MM-DD, which avoids hand-rolling the padding.
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
}

/** Whole days between two `YYYY-MM-DD` strings. Positive when `b` is later. */
export function daysBetween(a, b) {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** `YYYY-MM-DD` shifted by n days. */
export function addDays(iso, n) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Decide today's lesson.
 *
 * @param today          `YYYY-MM-DD`
 * @param items          SRS records: `{ wordId, box, dueOn }`
 * @param curriculum     every curriculum item, in file order
 * @param lastLessonDate `YYYY-MM-DD` of the previous lesson, or null if none
 * @returns `{ mode, reviewIds, newIds }` where mode is 'normal' | 'gentle-return' | 'first-run'
 */
export function selectLesson({ today, items = [], curriculum = [], lastLessonDate = null }) {
  const gapDays = lastLessonDate ? daysBetween(lastLessonDate, today) : null;
  const returningFromGap = gapDays !== null && gapDays > GAP_DAYS_FOR_LIGHT_RETURN;

  // Oldest due first, so a backlog drains in the order it built up rather than
  // by whatever order the index happened to return.
  const due = items
    .filter((i) => i.dueOn <= today)
    .sort((a, b) => (a.dueOn === b.dueOn ? a.wordId.localeCompare(b.wordId) : a.dueOn < b.dueOn ? -1 : 1));

  const reviewIds = due.slice(0, MAX_REVIEW_PER_DAY).map((i) => i.wordId);

  // A gap means the pile is already big; adding new words on the day someone
  // comes back is how they leave again. Review only, and let them win.
  if (returningFromGap) {
    return { mode: 'gentle-return', reviewIds, newIds: [], gapDays };
  }

  const known = new Set(items.map((i) => i.wordId));
  const room = Math.max(0, MAX_REVIEW_PER_DAY - reviewIds.length);
  const newIds = curriculum
    .filter((c) => !known.has(c.id))
    .slice(0, Math.min(NEW_WORDS_PER_DAY, Math.max(1, room)))
    .map((c) => c.id);

  return {
    mode: items.length === 0 ? 'first-run' : 'normal',
    reviewIds,
    newIds,
    gapDays,
  };
}

/**
 * Advance or reset one item's box after a graded submission.
 *
 * `spoken` is the gate ADR 0010 exists to protect: a word that was merely shown
 * in a message must never reach this function. Callers on the lesson-building
 * path do not call it at all.
 */
export function gradeItem(item, { spoken, score, today }) {
  if (!spoken) return item;

  const passed = score >= 3;
  const box = passed ? Math.min(item.box + 1, INTERVALS.length - 1) : 0;

  return {
    ...item,
    box,
    dueOn: addDays(today, INTERVALS[box]),
    timesSpoken: (item.timesSpoken ?? 0) + 1,
    timesFailed: (item.timesFailed ?? 0) + (passed ? 0 : 1),
  };
}

/** A brand-new item enters at box 0, due today -- it is taught, then reviewed. */
export const newItem = (wordId, today) => ({
  wordId,
  box: 0,
  dueOn: today,
  timesSpoken: 0,
  timesFailed: 0,
});

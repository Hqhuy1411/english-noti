/**
 * Tests for the study modules the notifier packages.
 *
 * No AWS, no credentials, no network: ddb.mjs imports its client lazily inside
 * the call, and srs.mjs is pure, so both can be imported and exercised directly.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { marshall, unmarshall, marshallItem, unmarshallItem } from '../src/study/ddb.mjs';
import {
  selectLesson,
  gradeItem,
  newItem,
  isoDate,
  daysBetween,
  addDays,
  MAX_REVIEW_PER_DAY,
} from '../src/study/srs.mjs';

test('every attribute type this project stores survives a round trip', () => {
  const value = {
    s: 'a string',
    n: 42,
    zero: 0,
    b: true,
    nul: null,
    list: [1, 'two', false],
    map: { nested: { deep: 'value' }, count: 3 },
  };
  assert.deepEqual(unmarshallItem(marshallItem(value)), value);
});

test('numbers marshall as strings, which is how DynamoDB carries them', () => {
  assert.deepEqual(marshall(7), { N: '7' });
  assert.equal(unmarshall({ N: '7' }), 7);
});

test('a value the marshaller cannot represent throws rather than writing junk', () => {
  assert.throws(() => marshall(NaN), TypeError);
  assert.throws(() => marshall(() => {}), TypeError);
});

test('due items come back oldest first, so a backlog drains in order', () => {
  const items = [
    { wordId: 'newer', box: 1, dueOn: '2026-08-24' },
    { wordId: 'oldest', box: 0, dueOn: '2026-08-20' },
    { wordId: 'middle', box: 0, dueOn: '2026-08-22' },
  ];
  const { reviewIds } = selectLesson({ today: '2026-08-25', items, curriculum: [], lastLessonDate: '2026-08-24' });
  assert.deepEqual(reviewIds, ['oldest', 'middle', 'newer']);
});

test('a word not yet due is not reviewed', () => {
  const items = [{ wordId: 'later', box: 2, dueOn: '2026-09-01' }];
  const { reviewIds } = selectLesson({ today: '2026-08-25', items, curriculum: [], lastLessonDate: '2026-08-24' });
  assert.deepEqual(reviewIds, []);
});

test('a backlog is capped, so a week away is not a forty-item pile', () => {
  const items = Array.from({ length: 40 }, (_, i) => ({
    wordId: `w${String(i).padStart(2, '0')}`,
    box: 0,
    dueOn: '2026-08-01',
  }));
  const { reviewIds } = selectLesson({ today: '2026-08-25', items, curriculum: [], lastLessonDate: '2026-08-24' });
  assert.equal(reviewIds.length, MAX_REVIEW_PER_DAY);
});

test('returning after more than three days away is review-only', () => {
  const items = [{ wordId: 'a', box: 0, dueOn: '2026-08-10' }];
  const curriculum = [{ id: 'brand-new' }];
  const lesson = selectLesson({ today: '2026-08-25', items, curriculum, lastLessonDate: '2026-08-18' });
  assert.equal(lesson.mode, 'gentle-return');
  assert.deepEqual(lesson.newIds, [], 'no new words on the day someone comes back');
  assert.equal(lesson.gapDays, 7);
});

test('a normal day introduces new words that are not already tracked', () => {
  const items = [{ wordId: 'known', box: 0, dueOn: '2026-08-25' }];
  const curriculum = [{ id: 'known' }, { id: 'fresh-one' }, { id: 'fresh-two' }];
  const { mode, newIds } = selectLesson({ today: '2026-08-25', items, curriculum, lastLessonDate: '2026-08-24' });
  assert.equal(mode, 'normal');
  assert.ok(!newIds.includes('known'));
  assert.ok(newIds.length > 0);
});

test('the very first run is labelled, so the message can say so', () => {
  const { mode } = selectLesson({
    today: '2026-08-25',
    items: [],
    curriculum: [{ id: 'a' }, { id: 'b' }],
    lastLessonDate: null,
  });
  assert.equal(mode, 'first-run');
});

test('two consecutive days do not produce the same lesson', () => {
  const curriculum = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}` }));
  let items = [];
  const dayOne = selectLesson({ today: '2026-08-25', items, curriculum, lastLessonDate: null });

  // Day one's new words become tracked items, exactly as the send path records them.
  items = dayOne.newIds.map((id) => newItem(id, '2026-08-25'));
  const dayTwo = selectLesson({ today: '2026-08-26', items, curriculum, lastLessonDate: '2026-08-25' });

  assert.notDeepEqual(dayTwo.newIds, dayOne.newIds);
});

test('a box never advances for a word that was only shown, never spoken', () => {
  const item = newItem('w', '2026-08-25');
  const after = gradeItem(item, { spoken: false, score: 5, today: '2026-08-25' });
  assert.deepEqual(after, item, 'reading a word must not graduate it');
});

test('a spoken word that scored well advances a box and is due later', () => {
  const item = { wordId: 'w', box: 0, dueOn: '2026-08-25', timesSpoken: 0, timesFailed: 0 };
  const after = gradeItem(item, { spoken: true, score: 4, today: '2026-08-25' });
  assert.equal(after.box, 1);
  assert.equal(after.dueOn, '2026-08-27', 'box 1 is a two-day interval');
  assert.equal(after.timesSpoken, 1);
  assert.equal(after.timesFailed, 0);
});

test('a spoken word that scored badly drops to box zero and returns tomorrow', () => {
  const item = { wordId: 'w', box: 4, dueOn: '2026-08-25', timesSpoken: 9, timesFailed: 1 };
  const after = gradeItem(item, { spoken: true, score: 1, today: '2026-08-25' });
  assert.equal(after.box, 0);
  assert.equal(after.dueOn, '2026-08-26');
  assert.equal(after.timesFailed, 2);
});

test('a mastered word stops climbing instead of running off the interval table', () => {
  let item = { wordId: 'w', box: 5, dueOn: '2026-08-25', timesSpoken: 20, timesFailed: 0 };
  item = gradeItem(item, { spoken: true, score: 5, today: '2026-08-25' });
  assert.equal(item.box, 5);
  assert.equal(item.dueOn, '2026-09-26', 'thirty-two days out');
});

test('dates are computed in Asia/Ho_Chi_Minh, not UTC', () => {
  // 22:30 UTC on the 24th is already 05:30 on the 25th in Vietnam. Getting this
  // wrong would file a lesson under the previous day and break the coach's
  // LESSON#<date> lookup.
  const late = new Date('2026-08-24T22:30:00Z');
  assert.equal(isoDate(late), '2026-08-25');
  assert.equal(isoDate(late, 'UTC'), '2026-08-24');
});

test('date arithmetic is whole days and survives a month boundary', () => {
  assert.equal(daysBetween('2026-08-18', '2026-08-25'), 7);
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(daysBetween('2026-08-25', '2026-08-25'), 0);
});

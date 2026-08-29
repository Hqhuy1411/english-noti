/**
 * Grading, with Transcribe's output and the study table faked.
 *
 * The cases that matter are the unhappy ones: a failed job, an empty recording,
 * and somebody else's job landing on the same event bus. Each of those, handled
 * wrongly, produces silence -- which the learner cannot tell apart from the
 * system still working.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { jobName, parseJobName, readTranscript } from '../src/audio.mjs';

test('a job name round-trips, because it is the only context the grader gets', () => {
  const name = jobName({ environment: 'prod', chatId: '6245321098', date: '2026-08-29', updateId: 77 });
  assert.equal(name, 'prod-6245321098-20260829-77');
  assert.deepEqual(parseJobName(name), {
    environment: 'prod',
    chatId: '6245321098',
    date: '2026-08-29',
    updateId: '77',
  });
});

test('a job belonging to something else is recognised as not ours', () => {
  assert.equal(parseJobName('some-other-teams-job'), null);
  assert.equal(parseJobName(undefined), null);
});

test('a test firing and a prod firing produce different job names on the same day', () => {
  const args = { chatId: '1', date: '2026-08-29', updateId: 5 };
  assert.notEqual(
    jobName({ ...args, environment: 'prod' }),
    jobName({ ...args, environment: 'test' }),
  );
});

test("Transcribe's output shape is read, not guessed at", () => {
  const payload = {
    results: {
      transcripts: [{ transcript: 'I pushed back on the deadline.' }],
      items: [{ type: 'pronunciation', content: 'pushed', confidence: '0.98' }],
    },
  };
  const { text, items } = readTranscript(payload);
  assert.equal(text, 'I pushed back on the deadline.');
  assert.equal(items.length, 1);
});

test('a malformed payload yields an empty transcript rather than throwing', () => {
  // Throwing here would retry the whole grade for a result that will never
  // parse, and the learner would get nothing either way.
  assert.deepEqual(readTranscript({}), { text: '', items: [] });
  assert.deepEqual(readTranscript(null), { text: '', items: [] });
});

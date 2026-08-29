/**
 * These assertions use exact numbers on fixed transcripts on purpose. The value
 * of this module is that it does not hallucinate, and a test that only checked
 * "returns a number" would not defend that.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  words,
  wordsPerMinute,
  fillerCount,
  targetsUsed,
  lowConfidenceWords,
  wordErrorRate,
  measure,
} from '../src/metrics.mjs';

test('punctuation and casing do not change the word count', () => {
  assert.deepEqual(words("Well, I'd push back -- politely!"), ['well', "i'd", 'push', 'back', 'politely']);
  assert.deepEqual(words('   '), []);
});

test('speech rate is words over minutes, rounded', () => {
  // 12 words in 6 seconds is 120 wpm.
  const twelve = 'one two three four five six seven eight nine ten eleven twelve';
  assert.equal(wordsPerMinute(twelve, 6), 120);
  assert.equal(wordsPerMinute(twelve, 12), 60);
});

test('speech rate is null rather than wrong when the duration is unknown', () => {
  assert.equal(wordsPerMinute('some words here', 0), null);
  assert.equal(wordsPerMinute('some words here', undefined), null);
});

test('fillers are counted, including the two-word ones', () => {
  const text = 'Um, I was like, you know, basically blocked. Uh, I mean, it was, like, hard.';
  // um, like, you know, basically, uh, i mean, like  = 7
  assert.equal(fillerCount(text), 7);
});

test('a word that merely contains a filler is not counted', () => {
  // "likely" and "umbrella" must not register as "like" and "um".
  assert.equal(fillerCount('It is likely the umbrella actually helped'), 1);
});

test('a target counts when it was said in an inflected form', () => {
  const { used, missed } = targetsUsed('I pushed back on the deadline yesterday', ['push back on']);
  assert.deepEqual(used, ['push back on']);
  assert.deepEqual(missed, []);
});

test('a target that was never said is reported missed, not quietly dropped', () => {
  const { used, missed } = targetsUsed('I talked to the team', ['push back on', 'circle back']);
  assert.deepEqual(used, []);
  assert.deepEqual(missed, ['push back on', 'circle back']);
});

test('the someone placeholder does not have to be spoken literally', () => {
  const { used } = targetsUsed('I gave the team a heads-up before deploying', [
    'give someone a heads-up',
  ]);
  assert.deepEqual(used, ['give someone a heads-up']);
});

test('only words Transcribe was unsure of are surfaced', () => {
  const items = [
    { type: 'pronunciation', content: 'think', confidence: '0.42' },
    { type: 'pronunciation', content: 'the', confidence: '0.99' },
    { type: 'punctuation', content: '.', confidence: '0.0' },
  ];
  assert.deepEqual(lowConfidenceWords(items), [{ word: 'think', confidence: 0.42 }]);
});

test('word error rate is exact against a known sentence', () => {
  const expected = 'let us circle back on that question after the release goes out';
  // One word wrong out of twelve.
  const said = 'let us circle back on that question after the release goes up';
  const wer = wordErrorRate(said, expected);
  assert.equal(wer.rate, 0.08);
  assert.deepEqual(wer.missed, ['out']);
});

test('a perfect reading scores zero, not almost zero', () => {
  const sentence = 'let us circle back on that question';
  assert.equal(wordErrorRate(sentence, sentence).rate, 0);
});

test('there is no error rate when nothing was given to read', () => {
  // A free answer has no target sentence; reporting a rate would invent a number.
  assert.equal(wordErrorRate('anything at all', null), null);
});

test('measure reports every signal the grader has before any model is asked', () => {
  const result = measure({
    transcript: 'Um, I pushed back on the deadline and looped in the lead.',
    durationSeconds: 6,
    targets: ['push back on', 'loop in', 'circle back'],
    expectedText: null,
    items: [{ type: 'pronunciation', content: 'looped', confidence: '0.31' }],
  });

  assert.equal(result.wordCount, 12);
  assert.equal(result.wordsPerMinute, 120);
  assert.equal(result.fillers, 1);
  assert.deepEqual(result.targets.used, ['push back on', 'loop in']);
  assert.deepEqual(result.targets.missed, ['circle back']);
  assert.deepEqual(result.lowConfidence, [{ word: 'looped', confidence: 0.31 }]);
  assert.equal(result.wer, null);
});

test('an irregular past form still counts as the target', () => {
  // "gave" shares no prefix with "give", so this only passes because the match
  // is on distinctive stems and a threshold, not on every word.
  const { used } = targetsUsed('I gave the team a heads-up before deploying', [
    'give someone a heads-up',
  ]);
  assert.deepEqual(used, ['give someone a heads-up']);
});

test('words inserted in the middle of an expression do not break the match', () => {
  const { used } = targetsUsed('We looped the whole platform team in early', ['loop in']);
  assert.deepEqual(used, ['loop in']);
});

test('a superficially similar sentence does not count as using the target', () => {
  const { missed } = targetsUsed('I sent the team a message about the deadline', [
    'give someone a heads-up',
  ]);
  assert.deepEqual(missed, ['give someone a heads-up'], 'a near miss must not be scored as a hit');
});

test('stems must appear in order, not merely be present somewhere', () => {
  // "back circle" contains both words but is not the expression. Order is what
  // separates using a collocation from happening to say its parts.
  const { used, missed } = targetsUsed('back circle', ['circle back']);
  assert.deepEqual(used, []);
  assert.deepEqual(missed, ['circle back']);
});

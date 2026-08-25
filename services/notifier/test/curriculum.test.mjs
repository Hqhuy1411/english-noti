/**
 * The curriculum is committed data the send path depends on, including as the
 * fallback when DynamoDB is unavailable (ADR 0009). A malformed entry would
 * therefore break a real 21:00 reminder, not just a feature -- so its shape is
 * asserted here rather than trusted.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const curriculum = JSON.parse(
  await readFile(new URL('../src/study/curriculum.json', import.meta.url), 'utf8'),
);

const TAGS = new Set(['work', 'daily', 'pronunciation']);
const POS = new Set(['verb', 'noun', 'adjective', 'adverb', 'phrase']);

test('the curriculum parses and is not empty', () => {
  assert.equal(curriculum.version, 1);
  assert.ok(Array.isArray(curriculum.items));
  assert.ok(curriculum.items.length >= 60, `only ${curriculum.items.length} items`);
});

test('every item carries the fields the lesson builder reads', () => {
  for (const item of curriculum.items) {
    const where = item.id ?? JSON.stringify(item).slice(0, 40);
    for (const key of ['id', 'word', 'pos', 'tags', 'collocations', 'example', 'viGloss', 'shadowSentence']) {
      assert.ok(item[key] != null && item[key] !== '', `${where}: missing ${key}`);
    }
    assert.ok(POS.has(item.pos), `${where}: unknown pos ${item.pos}`);
    assert.ok(item.tags.length > 0, `${where}: no tags`);
    for (const tag of item.tags) assert.ok(TAGS.has(tag), `${where}: unknown tag ${tag}`);
    assert.ok(item.collocations.length >= 2, `${where}: needs at least two collocations`);
  }
});

test('ids are unique and usable as a DynamoDB sort key', () => {
  const ids = curriculum.items.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate id');
  for (const id of ids) assert.match(id, /^[a-z0-9-]+$/, `${id} is not kebab-case ASCII`);
});

test('every tag the selector can be asked for actually exists in the data', () => {
  const present = new Set(curriculum.items.flatMap((i) => i.tags));
  for (const tag of TAGS) assert.ok(present.has(tag), `no items tagged ${tag}`);
});

test('shadow sentences are sayable: no digits, no acronyms to trip the transcript', () => {
  for (const item of curriculum.items) {
    assert.doesNotMatch(item.shadowSentence, /\d/, `${item.id}: contains a digit`);
    assert.doesNotMatch(item.shadowSentence, /\b[A-Z]{2,}\b/, `${item.id}: contains an acronym`);
    const words = item.shadowSentence.split(/\s+/).length;
    assert.ok(words >= 6 && words <= 20, `${item.id}: ${words} words is outside the readable range`);
  }
});

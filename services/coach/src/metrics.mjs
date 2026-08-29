/**
 * What can be measured about a spoken answer without asking a model.
 *
 * Everything here is arithmetic over a transcript, which makes it the most
 * trustworthy part of the grading path: it cannot hallucinate, it is identical
 * on every run, and it is testable with a fixed string and no credentials. The
 * LLM (ticket 0005) adds judgement on top -- it does not replace these.
 *
 * The honest limit, worth restating wherever this is read: Amazon Transcribe
 * measures **intelligibility**, not pronunciation. It cannot tell you your /θ/
 * is wrong. It can tell you "think" came out as "sink", which is a useful proxy
 * and a different claim. Do not present these numbers as a pronunciation score.
 */

/** Filler words worth counting. Deliberately short: a long list punishes normal speech. */
const FILLERS = ['uh', 'um', 'erm', 'like', 'you know', 'i mean', 'actually', 'basically'];

/** Below this, Transcribe was unsure enough to be worth showing the learner. */
export const LOW_CONFIDENCE = 0.6;

const normalise = (s) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const words = (text) => (normalise(text) === '' ? [] : normalise(text).split(' '));

/**
 * Words per minute. The single most actionable number here: natural
 * conversational English sits around 130-160, and a learner reading carefully
 * lands far below it.
 */
export function wordsPerMinute(text, durationSeconds) {
  if (!durationSeconds || durationSeconds <= 0) return null;
  return Math.round((words(text).length / durationSeconds) * 60);
}

/** Count filler words, including the two-word ones, without double counting. */
export function fillerCount(text) {
  const flat = ` ${normalise(text)} `;
  let total = 0;
  for (const filler of FILLERS) {
    const matches = flat.match(new RegExp(`\\s${filler}\\s`, 'g'));
    total += matches ? matches.length : 0;
  }
  return total;
}

/**
 * Which of the target expressions actually got said.
 *
 * Three things make exact matching wrong here, and all three are normal speech:
 * inflection ("pushed back on"), irregular forms ("gave" for "give"), and words
 * inserted in the middle ("gave *the team* a heads-up"). Marking correct speech
 * as a miss is the damaging error -- it tells someone they failed when they
 * didn't -- so the match is deliberately permissive.
 *
 * The rule: drop placeholders and function words, keep the distinctive stems,
 * and require most of them to appear in order with gaps allowed. "give someone a
 * heads-up" comes down to give / heads / up, and "I gave the team a heads-up"
 * matches two of three, which is enough.
 */
const IGNORED = new Set([
  'someone', 'something', 'somebody', 'a', 'an', 'the', 'to', 'on', 'in',
  'it', 'of', 'be', 'is', 'are', 'was', 'were', 'your', 'you',
]);

/** Share of a target's distinctive stems that must appear before it counts. */
export const TARGET_MATCH_THRESHOLD = 0.6;

const stem = (w) => w.slice(0, Math.max(3, w.length - 2));

export function targetsUsed(text, targets) {
  const said = words(text);
  const used = [];
  const missed = [];

  for (const target of targets) {
    const stems = words(target)
      .filter((w) => !IGNORED.has(w))
      .map(stem);

    if (stems.length === 0) {
      missed.push(target);
      continue;
    }

    // Subsequence match: stems must appear in order, but anything may sit
    // between them.
    let matched = 0;
    let cursor = 0;
    for (const s of stems) {
      const at = said.findIndex((w, i) => i >= cursor && w.startsWith(s));
      if (at !== -1) {
        matched += 1;
        cursor = at + 1;
      }
    }

    (matched / stems.length >= TARGET_MATCH_THRESHOLD ? used : missed).push(target);
  }

  return { used, missed };
}

/** Words Transcribe itself was unsure of -- the pronunciation suspects. */
export function lowConfidenceWords(items, threshold = LOW_CONFIDENCE) {
  return (items ?? [])
    .filter((item) => item.type === 'pronunciation' && Number(item.confidence) < threshold)
    .map((item) => ({ word: item.content, confidence: Number(item.confidence) }));
}

/**
 * Levenshtein distance over words, used for word error rate.
 *
 * Only meaningful when the target sentence is known -- a `shadow` task. For a
 * free answer there is nothing to compare against, and reporting a rate there
 * would be inventing a number.
 */
function editDistance(a, b) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j += 1) rows[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      rows[i][j] =
        a[i - 1] === b[j - 1]
          ? rows[i - 1][j - 1]
          : 1 + Math.min(rows[i - 1][j - 1], rows[i - 1][j], rows[i][j - 1]);
    }
  }
  return rows[a.length][b.length];
}

/**
 * Word error rate against a known sentence, plus the words that differ.
 * Returns null when there is no expected text -- see editDistance's note.
 */
export function wordErrorRate(transcript, expected) {
  if (!expected) return null;

  const said = words(transcript);
  const want = words(expected);
  if (want.length === 0) return null;

  const distance = editDistance(want, said);
  const saidSet = new Set(said);

  return {
    rate: Number((distance / want.length).toFixed(2)),
    missed: want.filter((w) => !saidSet.has(w)),
  };
}

/** Everything the grader knows before any model is consulted. */
export function measure({ transcript, durationSeconds, targets = [], expectedText = null, items = [] }) {
  return {
    wordCount: words(transcript).length,
    wordsPerMinute: wordsPerMinute(transcript, durationSeconds),
    fillers: fillerCount(transcript),
    targets: targetsUsed(transcript, targets),
    lowConfidence: lowConfidenceWords(items),
    wer: wordErrorRate(transcript, expectedText),
  };
}

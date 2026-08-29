/**
 * Turns a finished transcription into feedback and an SRS update.
 *
 * Woken by EventBridge when Transcribe changes state, which means the job name
 * is the only context available -- see audio.mjs's jobName for why that name
 * carries the chat, the date and the update id.
 *
 * No model is consulted here. Every number in the reply is arithmetic over the
 * transcript (metrics.mjs), which is what makes them worth trusting; judgement
 * and rewriting arrive with ticket 0005. The most useful line is the transcript
 * itself: seeing what a machine heard is the feedback, before any score.
 */

import { getBotToken } from './config.mjs';
import { sendMessage } from './telegram.mjs';
import { query, putItem } from './ddb.mjs';
import { parseJobName, getJson, readTranscript } from './audio.mjs';
import { measure } from './metrics.mjs';
import * as log from './logger.mjs';

const esc = (s) =>
  String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** Comfortable conversational English. Below this reads as hesitant, above as rushed. */
const NATURAL_WPM = [110, 170];

async function loadLesson(table, chatId, date, environment) {
  const sk = environment === 'prod' ? `LESSON#${date}` : `LESSON#${date}#${environment}`;
  const rows = await query(table, {
    keyCondition: 'PK = :pk AND SK = :sk',
    expressionValues: { ':pk': `USER#${chatId}`, ':sk': sk },
  });
  return rows[0] ?? null;
}

function renderFeedback({ transcript, metrics, lesson }) {
  const lines = ['<b>🎧 Máy nghe được</b>', `<i>${esc(transcript)}</i>`, ''];

  if (metrics.wordsPerMinute != null) {
    const [slow, fast] = NATURAL_WPM;
    const verdict =
      metrics.wordsPerMinute < slow ? ' — chậm hơn hội thoại tự nhiên'
      : metrics.wordsPerMinute > fast ? ' — nhanh hơn hội thoại tự nhiên'
      : ' — đúng nhịp tự nhiên';
    lines.push(`<b>Tốc độ</b> ${metrics.wordsPerMinute} từ/phút${esc(verdict)}`);
  }
  lines.push(`<b>Từ đệm</b> ${metrics.fillers}`, '');

  if (metrics.targets.used.length) {
    lines.push(`✅ <b>Đã dùng:</b> ${esc(metrics.targets.used.join(' · '))}`);
  }
  if (metrics.targets.missed.length) {
    lines.push(`⬜ <b>Chưa dùng:</b> ${esc(metrics.targets.missed.join(' · '))}`);
  }

  if (metrics.wer) {
    lines.push(
      '',
      `<b>So với câu mẫu</b> sai ${Math.round(metrics.wer.rate * 100)}%`,
      ...(metrics.wer.missed.length
        ? [`Trượt: ${esc(metrics.wer.missed.join(', '))}`]
        : ['Đọc khớp hoàn toàn.']),
    );
  }

  if (metrics.lowConfidence.length) {
    lines.push(
      '',
      '<b>🔊 Máy không chắc ở những từ này</b>',
      esc(metrics.lowConfidence.map((w) => w.word).join(', ')),
      '<i>Đây là chỗ phát âm chưa rõ, không phải lỗi ngữ pháp.</i>',
    );
  }

  if (lesson?.taskType === 'explain') {
    lines.push('', '<i>Nói lại lần nữa, ngắn hơn 20%. Lần hai bao giờ cũng gọn hơn.</i>');
  }

  return lines.join('\n');
}

export const handler = async (event) => {
  const detail = event?.detail ?? {};
  const name = detail.TranscriptionJobName;
  const parsed = parseJobName(name);

  if (!parsed) {
    // Another job in the same account. Not ours, not an error.
    log.info('grade.ignored', { jobName: name });
    return;
  }

  const token = await getBotToken();
  const { chatId, date, environment } = parsed;

  if (detail.TranscriptionJobStatus === 'FAILED') {
    // Silence here is indistinguishable from "still running", which is why the
    // EventBridge rule listens for FAILED at all.
    log.error('grade.transcription-failed', { jobName: name, reason: detail.FailureReason });
    await sendMessage(
      token,
      chatId,
      '⚠️ Không nghe được bản ghi này. Thử thu lại ở nơi yên tĩnh hơn, giữ máy gần miệng.',
    );
    return;
  }

  const table = process.env.STUDY_TABLE;
  const bucket = process.env.AUDIO_BUCKET;

  const payload = await getJson(bucket, `transcripts/${name}.json`);
  const { text: transcript, items } = readTranscript(payload);

  if (!transcript.trim()) {
    log.warn('grade.empty-transcript', { jobName: name });
    await sendMessage(token, chatId, '⚠️ Bản ghi không có tiếng nói nào. Thử lại nhé.');
    return;
  }

  const lesson = await loadLesson(table, chatId, date, environment);
  const targets = [...(lesson?.newIds ?? []), ...(lesson?.reviewIds ?? [])];

  const metrics = measure({
    transcript,
    durationSeconds: Number(detail.DurationSeconds) || null,
    targets,
    expectedText: lesson?.expectedText ?? null,
    items,
  });

  await sendMessage(token, chatId, renderFeedback({ transcript, metrics, lesson }));

  await putItem(table, {
    PK: `USER#${chatId}`,
    SK: `SUB#${new Date().toISOString()}`,
    kind: 'graded',
    jobName: name,
    date,
    transcript,
    wordsPerMinute: metrics.wordsPerMinute ?? 0,
    fillers: metrics.fillers,
    targetsUsed: metrics.targets.used,
    targetsMissed: metrics.targets.missed,
  });

  log.info('grade.done', {
    jobName: name,
    words: metrics.wordCount,
    wpm: metrics.wordsPerMinute,
    used: metrics.targets.used.length,
    missed: metrics.targets.missed.length,
  });
};

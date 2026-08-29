/**
 * Moving a voice note from Telegram to Transcribe, and reading the result back.
 *
 * All clients are imported lazily, the same pattern config.mjs uses, so the test
 * suite can import this file with no AWS SDK present.
 */

/**
 * The job name is the only context EventBridge hands the grader when Transcribe
 * finishes -- there is no way to attach metadata to a job. So the name *is* the
 * lookup key, and it has to be unique in the region, which update_id guarantees.
 */
export const jobName = ({ environment, chatId, date, updateId }) =>
  `${environment}-${chatId}-${date.replaceAll('-', '')}-${updateId}`;

/** Parse a job name back into its parts. Returns null if it is not ours. */
export function parseJobName(name) {
  const match = /^(\w+)-(\d+)-(\d{4})(\d{2})(\d{2})-(\d+)$/.exec(name ?? '');
  if (!match) return null;
  const [, environment, chatId, y, m, d, updateId] = match;
  return { environment, chatId, date: `${y}-${m}-${d}`, updateId };
}

/** Download the voice note straight from Telegram. Returns bytes. */
export async function downloadVoice(token, filePath) {
  // The token is in this URL, so nothing built from it may reach an error.
  const response = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!response.ok) throw new Error(`voice download failed: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function putObject(bucket, key, body, contentType) {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({});
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
  );
  return `s3://${bucket}/${key}`;
}

export async function getJson(bucket, key) {
  const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({});
  const { Body } = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return JSON.parse(await Body.transformToString());
}

/**
 * Start a batch transcription. Batch rather than streaming: streaming needs an
 * HTTP/2 event stream, and a learner waiting thirty seconds for written feedback
 * is not a latency problem worth that complexity.
 */
export async function startTranscription({ name, mediaUri, bucket, languageCode = 'en-US' }) {
  const { TranscribeClient, StartTranscriptionJobCommand } = await import(
    '@aws-sdk/client-transcribe'
  );
  const client = new TranscribeClient({});
  await client.send(
    new StartTranscriptionJobCommand({
      TranscriptionJobName: name,
      // Telegram voice notes are Opus in an Ogg container, which Transcribe
      // supports for batch jobs.
      MediaFormat: 'ogg',
      LanguageCode: languageCode,
      Media: { MediaFileUri: mediaUri },
      OutputBucketName: bucket,
      OutputKey: `transcripts/${name}.json`,
    }),
  );
}

/** Pull the plain transcript and the per-word items out of Transcribe's output. */
export function readTranscript(payload) {
  const result = payload?.results;
  return {
    text: result?.transcripts?.[0]?.transcript ?? '',
    items: result?.items ?? [],
  };
}

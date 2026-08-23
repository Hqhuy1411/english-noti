/**
 * Message content.
 *
 * PHASE 2 SEAM: this is the only file that needs to change when the English
 * lesson service comes online -- replace the static body with a call to that
 * service. The scheduler, the Telegram client and the logging around it all
 * stay exactly as they are.
 *
 * Phase 1 stamps the Vietnam-local date and time into the message so a received
 * notification is itself the proof that the schedule fired at the intended
 * local time, with no need to cross-check CloudWatch. Non-production
 * environments say so in the first line, so a test firing is never mistaken for
 * the real reminder.
 */

const TZ = 'Asia/Ho_Chi_Minh';

const vnDateTime = (now) =>
  new Intl.DateTimeFormat('vi-VN', {
    timeZone: TZ,
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(now);

/** Escape the three characters that matter for Telegram's HTML parse_mode. */
const esc = (s) =>
  String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

export function buildMessage(now = new Date(), environment = process.env.ENVIRONMENT ?? 'prod') {
  const isProd = environment === 'prod';

  const heading = isProd
    ? '<b>🇬🇧 Đã tới giờ học tiếng Anh!</b>'
    : `<b>🧪 [${esc(environment.toUpperCase())}] Test thông báo học tiếng Anh</b>`;

  const body = isProd
    ? 'Dành 20 phút cho hôm nay nhé. Nội dung bài học sẽ được gắn vào đây ở Phase 2.'
    : 'Đây là tin nhắn test -- không phải nhắc nhở thật. Nếu bạn nhận được nó, toàn bộ đường đi scheduler → Lambda → Telegram đang hoạt động.';

  return [heading, '', `🕘 ${esc(vnDateTime(now))} (${TZ})`, '', body].join('\n');
}

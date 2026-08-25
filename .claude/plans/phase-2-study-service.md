# Phase 2 — Study service: speaking + từ vựng, tích hợp vào notifier

## Context

Phase 1 đã live: mỗi 21:00 Asia/Ho_Chi_Minh một Lambda gửi Telegram message với nội
dung placeholder. Backlog 0001 nói thẳng vấn đề: *"Every day it fires, the system
trains the recipient to ignore it."* Punctuality đã giải quyết xong và đo được
(~36 s, ADR 0003); thứ còn thiếu là nội dung.

Yêu cầu: service học tiếng Anh tập trung **speaking + từ vựng**, thỉnh thoảng
**writing**; mục tiêu **tiếng Anh công việc/IT + giao tiếp hằng ngày + phát âm/trôi
chảy**; **15–20 phút/ngày**; và **có chiều ngược lại** — gửi voice note / text về,
hệ thống chấm và phản hồi.

Kết quả mong muốn: tin nhắn 21:00 trở thành một buổi học thật, có trí nhớ, và một từ
chỉ "tốt nghiệp" khi đã **được nói ra**, không phải khi đã được đọc.

---

## 1. Thiết kế nội dung học

### Vòng lặp hằng ngày, 21:00

| # | Khối | Thời lượng | Nội dung |
|---|---|---|---|
| 1 | **Ôn (SRS)** | ~4 phút | 4–6 từ đến hạn. Mỗi từ là một **chunk nói được**: `word — collocation — câu ví dụ tự nhiên — nghĩa VN`, không phải định nghĩa từ điển. |
| 2 | **Từ mới** | ~3 phút | 3–4 từ, gom quanh **một tình huống** (`escalating a blocker`, `pushing back on a deadline`, `ordering at a café`). |
| 3 | **Speaking task** | 5–8 phút | Một trong ba loại, luân phiên. |
| 4 | **Writing task** | ~5 phút | Chỉ Thứ 2 / Tư / Sáu — 4–6 câu dùng từ của tuần. |

Inline keyboard: `🎤 Nói` · `📝 Viết` · `📖 Thêm ví dụ` · `😴 Bỏ qua hôm nay`.

### Ba loại speaking task

| Loại | Yêu cầu | Đo cái gì | Vì sao chấm được |
|---|---|---|---|
| `shadow` | Đọc to đúng câu này | Phát âm / intelligibility | **Biết trước câu đích** → so transcript với câu đích = word-error-rate thật. Tín hiệu mạnh nhất trong cả hệ thống. |
| `answer` | Trả lời 45–60 s, dùng ≥ 2 từ hôm nay | Trôi chảy + dùng từ chủ động | WPM, filler count, có dùng từ đích không |
| `roleplay` | "Standup, API integration bị trễ. Nói với team." | Tiếng Anh công việc | LLM chấm task achievement + register |

### Invariant làm nó khác một app Anki

**Một từ chỉ lên box SRS tiếp theo khi đã được *nói ra* trong một submission, không
phải khi đã được đọc trong message.** Đọc lướt không đẩy được từ đi. Ghi vào ADR và
rule để không ai nới lỏng nó sau này.

### Khi bạn bỏ lỡ nhiều ngày (chuyện chắc chắn sẽ xảy ra)

Invariant ở trên có một hệ quả xấu nếu để mặc: nghỉ một tuần thì hàng đợi "đến hạn"
phình lên và bài ngày thứ tám dài 40 phút — đúng cái làm người ta bỏ hẳn. Nên:

- **Trần cứng 6 từ ôn/ngày.** Từ quá hạn xếp theo `dueOn` cũ nhất trước; phần dư
  không đến hạn dồn, nó chỉ chờ.
- **Nghỉ > 3 ngày ⇒ ngày quay lại là bài nhẹ**: chỉ ôn, không từ mới, task `shadow`
  ngắn. Quay lại phải dễ, không phải bị phạt.
- Không có "streak bị mất" hiển thị. Streak để khích lệ, không để trừng phạt.

### Phản hồi sau voice note

1. **Transcript máy nghe được** — riêng cái này đã có giá trị: bạn thấy chỗ nào máy nghe ra từ khác.
2. **Từ nghi ngờ phát âm** — confidence thấp, hoặc (với `shadow`) lệch so câu đích.
3. **WPM** và **số filler** (`uh`, `um`, `like`, `you know`) — đếm cục bộ, không cần LLM.
4. **Từ đích đã dùng / chưa dùng.**
5. **"Say it like this instead"** — một bản viết lại tự nhiên hơn (LLM).
6. **Điểm 0–5** → cập nhật SRS box.

### Giới hạn phải nói thẳng

Amazon Transcribe đo **intelligibility**, **không** đo phoneme. Nó không nói được
"/θ/ của bạn sai"; nó cho thấy `think` ra thành `sink`. Với `shadow` (biết câu đích)
tín hiệu mạnh; với free-response yếu hơn. Giữ seam `assess.mjs` để sau này cắm
Azure Speech Pronunciation Assessment / Speechace nếu muốn điểm phoneme thật. Đừng
quảng cáo nó là chấm phát âm.

### Weekly digest, Chủ nhật 21:00

Từ đã master, **tỉ lệ dùng chủ động** (nói ra được / đã học), 3 lỗi lặp nhiều nhất,
và một bộ 3 câu hỏi "mock interview".

---

## 2. Kiến trúc

Giữ nguyên hình dạng ADR 0002 — root stack + một nested stack mỗi service.

```
template.yaml (root)
├── NotifierProd / NotifierTest    services/notifier/   ← đã có; đổi lesson.mjs + 1 dòng handler
├── Study                          services/study/      ← MỚI: DynamoDB + curriculum + digest
└── Coach                          services/coach/      ← MỚI: webhook + audio + chấm bài
```

```
21:00  Scheduler ─▶ notifier ─▶ lesson.mjs ─┬─▶ DynamoDB (từ đến hạn; ghi LESSON#today)
                                            └─▶ LLM (soạn bài)  ────▶ Telegram ▶ 📱

📱 voice ─▶ HttpApi ─▶ ingest ─▶ S3 audio ─▶ Transcribe
                                                 │ EventBridge "Transcribe Job State Change"
                                                 ▼
                       Telegram ◀── grade ◀── transcript + LESSON#today
                                       └──▶ DynamoDB (cập nhật SRS box)
```

### 2.1 `services/study/` — data plane

**`StudyTable`** — DynamoDB on-demand, single table:

| PK | SK | Nội dung |
|---|---|---|
| `USER#<chatId>` | `PROFILE` | level, streak, tỉ lệ work/daily/pronunciation |
| `USER#<chatId>` | `ITEM#<wordId>` | SRS: `box`, `dueOn`, `timesSpoken`, `timesFailed` |
| `USER#<chatId>` | `LESSON#<YYYY-MM-DD>` | bài **đã gửi thật**: items, taskType, prompt, expectedText, messageId |
| `USER#<chatId>` | `SUB#<ts>` | submission: transcript, metrics, feedback, điểm |

GSI1 (`GSI1PK = USER#<chatId>#DUE`, `GSI1SK = <dueOn>`) cho query "đến hạn ≤ hôm nay".
`LESSON#<date>` là bản ghi coach đọc lại khi voice note tới — nó biết bạn được yêu
cầu nói câu gì. Env `test` ghi `LESSON#<date>#test` để không làm bẩn SRS của prod.

**`data/curriculum.json`** — commit vào repo. Vừa là seed, vừa là **fallback offline**
khi LLM hoặc DynamoDB lỗi.

### 2.2 `services/notifier/` — điểm căng duy nhất, phải xử lý minh bạch

`handler.mjs:29` hiện là `await sendMessage(token, chatId, buildMessage())` — **`buildMessage()`
không được await**. Mọi nguồn nội dung đều async, nên seam bắt buộc phải async. Thêm
nữa inline keyboard cần `telegram.mjs` nhận `replyMarkup` — mà ADR 0007 nói rõ đổi
*format* thì **phải mở lại ADR, không được nới lặng lẽ**.

**Seam mới, tuyên bố trong ADR 0009 (ADR 0007 chuyển sang `superseded by 0009`):**

```js
// services/notifier/src/lesson.mjs
export async function buildLesson({ now = new Date(), environment } = {})
  // → { text, replyMarkup, lessonId }
```

Toàn bộ diff của notifier qua cả Phase 2:
- `lesson.mjs` — viết lại (đúng vai trò seam).
- `handler.mjs` — **đúng một dòng**.
- `telegram.mjs` — `sendMessage(token, chatId, text, replyMarkup)`, tham số thứ tư
  optional; `undefined` ⇒ body giống hệt hôm nay (9 test hiện có phải xanh không sửa logic).
- `scripts/send-now.mjs` + `test/notifier.test.mjs` — `buildMessage` có **3 call site**, tất cả phải khớp.

**Quy tắc bất di bất dịch:** LLM hoặc DynamoDB lỗi ⇒ `buildLesson` fallback sang chọn
deterministic từ `curriculum.json` và **vẫn gửi**. Delivery guarantee mà Phase 1 đã
trả giá để có được không bao giờ được phụ thuộc vào một LLM call.

### 2.3 `services/coach/` — chiều ngược lại

- **`ReplyApi`** — `AWS::Serverless::HttpApi`, một route `POST /telegram`.
- **Bảo mật (ADR 0011):** Telegram `secret_token` (set qua `setWebhook`) so với SSM
  SecureString mỗi request; `update.message.chat.id` phải khớp allowlist. Update bị
  từ chối → **200 rỗng** (non-2xx làm Telegram retry liên tục) và log lại. Không
  secret nào vào env var / log line.
- **`IngestFunction`** — phải trả 200 nhanh (< 3 s):
  - text → ghi `SUB#`, invoke `GradeFunction` async (`InvocationType: Event`), 200.
  - voice → `getFile` → tải `api.telegram.org/file/bot<token>/<path>` → `PutObject`
    vào `AudioBucket` → `StartTranscriptionJob` (`en-US`, `MediaFormat: ogg`) →
    ack `🎧 Đang nghe...` → 200.
  - `callback_query` → `answerCallbackQuery` rồi xử lý.
- **Idempotency — không được bỏ qua.** Telegram **gửi lại** update khi không nhận
  được 200 đủ nhanh. Không khử trùng lặp thì một voice note sẽ tạo hai Transcribe job
  và hai tin feedback. Khử bằng `update_id`: ghi có điều kiện
  `ConditionExpression: attribute_not_exists(PK)` vào item `UPDATE#<update_id>` (có
  TTL 24 giờ); trúng điều kiện ⇒ đã xử lý ⇒ trả 200 và dừng.
- **Tên Transcribe job phải tự giải thích.** `GradeFunction` chỉ nhận được tên job từ
  EventBridge, không nhận context nào khác — nên tên job **là** khoá tra ngược:
  `<env>-<chatId>-<YYYYMMDD>-<update_id>`. Tên job phải duy nhất trong region, và
  `<update_id>` bảo đảm điều đó.
- **`AudioBucket`** — block public access, SSE-S3, lifecycle expire 30 ngày.
- **`TranscribeDoneRule`** — EventBridge: `source: aws.transcribe`, `detail-type:
  Transcribe Job State Change`, lọc `COMPLETED`/`FAILED` → `GradeFunction`.
  (Đã xác nhận trong AWS docs; Transcribe batch hỗ trợ container **Ogg** — đúng định
  dạng Telegram voice note.)
- **`GradeFunction`:** đọc transcript + `LESSON#<date>` → tính metric cục bộ → **một**
  LLM call cho phần định tính → cập nhật SRS → ghi `SUB#` → gửi feedback.
- **`services/coach/src/telegram.mjs`** — bản copy của client hiện có, thêm `getFile`,
  `answerCallbackQuery`, `sendChatAction`. Chọn **nhân bản ~60 dòng** thay vì Lambda
  Layer: layer thêm một bước build cho 60 dòng code, và coach cần method khác notifier.
  Ghi lý do vào ADR để lần sau không ai "sửa" nó thành layer.

### 2.4 Ràng buộc kỹ thuật đã kiểm chứng

- **ADR 0001 (zero npm deps) giữ được.** AWS SDK v3 có trong runtime `nodejs22.x`,
  import **lazy** đúng như `config.mjs` đang làm với `client-ssm`.
- **`lib-dynamodb` / `util-dynamodb` không chắc có trong runtime** → viết
  `marshall/unmarshall` tí hon (~30 dòng, chỉ S/N/BOOL/L/M). Rẻ hơn nhiều so với mở
  lại ADR 0001.
- Mỗi Lambda mới **phải** có `AWS::Logs::LogGroup` tường minh + `RetentionInDays`;
  IAM chỉ qua SAM policy template scoped theo path.
- **Permission mới phải liệt kê một lượt trước khi deploy** (`docs/aws-permissions.json`):
  DynamoDB scoped table, S3 scoped bucket, `apigateway:*`, `transcribe:StartTranscriptionJob`,
  `events:PutRule/PutTargets`, và **quyền đọc lại** cho mỗi loại resource — trap đã ghi
  trong DEPLOY-LOG: `scheduler:CreateSchedule` một mình không đủ vì CloudFormation đọc
  resource lại sau khi tạo. Sáu vòng deploy đã trả giá cho bài học này.

---

## 3. Model & chi phí

Ước lượng tháng: **~208K input token, ~82K output token, ~60 phút audio**.

### Model rẻ trên Bedrock, có ở `ap-southeast-1`

| Model | $/1M in | $/1M out | Chi phí/tháng ở mức của bạn | Nguồn |
|---|---|---|---|---|
| Amazon Nova Micro | $0.035 | $0.14 | **$0.02** | [blog cost-optimization](https://aws.amazon.com/blogs/machine-learning/effective-cost-optimization-strategies-for-amazon-bedrock/) (us-east-2, 21/05/2025) |
| Amazon Nova Lite | $0.06 | $0.24 | **$0.03** | như trên |
| **Amazon Nova 2 Lite** | $0.30 | $2.50 | **$0.27** | [blog Nova 2 Lite + Claude](https://aws.amazon.com/blogs/machine-learning/pair-nova-2-lite-with-claude-for-cost-optimized-document-processing/) |
| Amazon Nova Pro | $0.80 | $3.20 | **$0.43** | blog cost-optimization |
| **Claude Haiku 4.5** | $1.00 | $5.00 | **$0.62** | giá **first-party Anthropic**; giá Bedrock là bảng riêng — **chưa xác minh được**, phải mở [aws.amazon.com/bedrock/pricing](https://aws.amazon.com/bedrock/pricing/) và chọn region |

**Cả cột chi phí đều dưới $1/tháng.** Khoảng cách từ model rẻ nhất tới model tốt nhất
là **~$0.60/tháng** — nhỏ hơn tiền Transcribe ($1.4). Nên **đừng tối ưu chi phí model
ở đây**; chọn Nova Micro để tiết kiệm $0.60 mà nhận feedback tiếng Anh kém hơn là một
trade tệ. Điều đáng tối ưu là chất lượng phán đoán tiếng Anh.

Đã xác minh:
- **Nova 2 Lite** (`amazon.nova-2-lite-v1:0`) có APAC cross-region profile bao gồm
  `ap-southeast-1` → gọi qua `apac.` prefix ([supported regions for batch inference](https://docs.aws.amazon.com/bedrock/latest/userguide/batch-inference-supported.html)).
- **Claude Haiku 4.5** có `ap-southeast-1` trong bảng regional availability
  ([model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-4-5.html)).
- **Prompt caching** giảm tới **90%** chi phí và 85% latency, hỗ trợ Nova Micro/Lite/Pro
  và Claude Haiku/Sonnet ([Bedrock prompt caching](https://aws.amazon.com/bedrock/prompt-caching/)).
  Rubric của ta là prefix ổn định ~1.5K token dùng lại mọi call → ăn cache tốt, miễn là
  prefix **không chứa timestamp hay id thay đổi**.
- **Batch inference** giảm **50%**, nhưng **không hợp ở đây**: nó thêm latency không
  đoán trước cho một luồng mà bạn đang ngồi chờ feedback. Ghi lại lý do loại, đừng để
  lần sau có người đề xuất lại.

### Khuyến nghị: định tuyến theo job, không chọn một model cho tất cả

| Job | Model | Lý do |
|---|---|---|
| (a) Soạn bài hằng ngày | **Nova 2 Lite** | Sinh nội dung có cấu trúc từ curriculum đã có sẵn; rẻ; APAC profile ở `ap-southeast-1` |
| (b) Chấm speaking | **Claude Haiku 4.5** | Đây là chỗ **duy nhất** chất lượng phán đoán tiếng Anh thực sự quan trọng: register, tự nhiên, viết lại. Đừng tiết kiệm ở đây |
| (c) Chấm writing | **Claude Haiku 4.5** | Như trên |

Tổng LLM: **~$0.5/tháng**. Cộng Transcribe ~$1.4 và hạ tầng < $0.5 ⇒ **~$2.4/tháng**.

### Rủi ro phải kiểm chứng trước khi cam kết Bedrock

Bedrock cần `@aws-sdk/client-bedrock-runtime`. AWS chỉ nói runtime Node.js "bao gồm
một minor version của SDK v3" và **khuyến nghị tự đóng gói client** — **không có tài
liệu nào liệt kê client nào nằm trong bundle**. Nếu `client-bedrock-runtime` không có
sẵn thì phải đóng gói ⇒ **mở lại ADR 0001 (zero npm deps)**. Đây là rủi ro thật, phải
kiểm bằng một deploy thử (import client rồi in `package.json` version) **trước** khi
chốt ADR, không phải đoán. Claude API trực tiếp không có rủi ro này vì chỉ dùng `fetch`.

**Quy tắc kiến trúc, độc lập với model:** LLM nằm sau seam `llm.mjs` với một interface
duy nhất, và **mọi call đều có fallback**. Đổi model — kể cả đổi hẳn provider — là đổi
một hằng số và một ADR, không phải viết lại grade path.

---

## 4. Checklist

Ký hiệu owner: **`main`** = session chính · **`ck`** = subagent `convention-keeper`
(`.claude/agents/convention-keeper.md`) · **`user`** = bạn làm tay (secret) ·
**`skill`** = skill có sẵn trong `.claude/skills/`.

> **Số ADR trong plan này (0009, 0010, 0011) là dự kiến.** Số thật do
> `convention-keeper` phát tại thời điểm viết, sau khi task 0.1 sửa xong
> `docs/STATUS.md`. Đừng hardcode số từ plan vào file — hỏi `ck` lấy số kế tiếp,
> vì "numbers are never reused" và index sẽ lệch nếu đoán.

### Phase 0 — Dọn nền (làm trước khi viết dòng code nào)

| # | Task | Owner | Done when |
|---|---|---|---|
| 0.1 | ✅ **XONG (2026-08-25), nhưng phần lớn báo cáo ban đầu là sai.** Ba trong bốn điểm "lệch" (số ADR kế tiếp, trạng thái test schedule, thiếu row `RUN-HISTORY.md`) **đã được commit `6d022bb` và `1807579` sửa từ 2026-08-24** — chúng được báo là lệch vì `docs/STATUS.md` đã bị đọc một lần ở đầu session rồi trích dẫn lại như hiện trạng. **Bài học: đọc lại file trước khi báo nó lệch, nhất là khi `git log` cho thấy có commit mới.** Lỗi thật duy nhất: `.claude/commands/deploy.md` trích "ADR 0008" cho việc park test schedule, nhưng ADR 0008 là run-history và **không có ADR nào ghi quyết định park** — đã sửa thành trỏ `docs/STATUS.md` và nói thẳng là không có decision record. `ck` tự tìm thêm một lệch thật: STATUS vẫn liệt kê "interactive done/snooze buttons" là chưa ticket trong khi ticket 0003 đã phủ nó. | `ck` | Đã chạy: STATUS khớp `ls docs/decisions/` (next number = 0009), `deploy.md` không còn trích ADR sai, STATUS "Last reviewed" = 2026-08-25 |

| 0.2 | 4 file đang dirty chưa commit (`CLAUDE.md`, `README.md`, `docs/RUNBOOK.md`, + `docs/aws-billing-permissions.json` và `scripts/` chưa track). Commit hoặc bỏ trước khi Phase 2 chồng thêm diff. | `main` | `git status --short` sạch |
| 0.3 | **Backlog 0002 — xoay bot token đã lộ trong transcript.** Phase 2 sẽ thêm 1–2 secret nữa; xoay cái cũ trước thì gọn. Ticket ghi rõ **bạn tự làm tay**, token không đi qua transcript của agent. | `user` | Token cũ trả 401; một lần fire thật vẫn gửi được **mà không cần redeploy** |
| 0.4 | ✅ **XONG (2026-08-25).** Mở 4 ticket backlog **0003–0006** (một cho mỗi phase 2.2–2.5), theo template `docs/backlog/README.md`, thêm row vào STATUS. | `ck` | 4 file tồn tại, STATUS có 4 row, số không trùng |
| 0.5 | ✅ **XONG (2026-08-25).** **Chuyển plan này vào repo: `.claude/plans/phase-2-study-service.md`.** Plan của dự án không đặt ở `~/.claude/` — đó là thư mục machine-local, không sync, teammate không thấy, đúng cùng lý do `docs/` tồn tại. `.gitignore` chỉ loại `.claude/settings.local.json`, nên `.claude/plans/` **được commit**. Ghi quy ước này vào `CLAUDE.md` (bảng "Tooling in `.claude/`") để session sau không lặp lại lỗi. | `main` + `ck` | File tồn tại trong repo, `git status` thấy nó là file mới; `CLAUDE.md` có dòng cho `plans/`; bản ở `~/.claude/plans/` không còn là nguồn sự thật |

### Phase 2.1 — Từ vựng có trí nhớ (đóng backlog 0001; **chưa LLM, chưa webhook**)

| # | Task | Owner | Done when |
|---|---|---|---|
| 1.1 | **ADR 0009** — trả lời 3 câu hỏi mở của backlog 0001 (nguồn nội dung / có state không / module hay service) **và** tuyên bố seam mới `async buildLesson()`. Set `docs/decisions/0007` → `Status: superseded by 0009` (theo rule "supersede beats editing"). | `ck` | File tồn tại, có đủ Context/Decision/Rejected/Consequences/Evidence; index có row; 0007 đã đổi status; STATUS "next number" = 0010 |
| 1.2 | **ADR 0010** — single-table key schema + GSI1 + invariant "từ chỉ lên box khi đã được nói" | `ck` | như trên |
| 1.3 | `.claude/rules/study-data.md` (`paths: services/study/**`) — key schema, cấm lưu audio trong table, invariant SRS | `ck` | File có frontmatter `paths:`, không lặp lại nội dung ADR |
| 1.4 | `services/study/template.yaml` — `StudyTable` + GSI1 + Outputs `TableName`/`TableArn`. On-demand billing. | `main` | Hook `validate-template.sh` xanh |
| 1.5 | Root `template.yaml` — thêm block `Study` (`AWS::Serverless::Application`); thêm Parameter `StudyTableName` truyền xuống notifier | `main` | `sam build` vẫn liệt kê **cả hai** `NotifierProd/NotifierFunction` và `NotifierTest/NotifierFunction` |
| 1.6 | `services/notifier/template.yaml` — nhận `StudyTableName`, thêm env var, thêm `DynamoDBCrudPolicy` scoped đúng table | `main` | `sam validate --lint` xanh; không có managed policy rộng nào |
| 1.7 | `services/study/data/curriculum.json` — **60 mục cho v1** (đủ ~6 tuần), tag `work` / `daily` / `pronunciation`, mỗi mục có `word`, `collocations[]`, `example`, `viGloss`, `shadowSentence`. Mở rộng lên 300+ sau. | `main` (có thể giao subagent soạn nội dung) | JSON parse được; test khẳng định mọi mục đủ field và tag hợp lệ |
| 1.8 | `services/study/src/ddb.mjs` — marshall/unmarshall tí hon (S/N/BOOL/L/M) | `main` | Test round-trip cho từng kiểu |
| 1.9 | `services/study/src/srs.mjs` — Leitner boxes, chọn từ đến hạn + từ mới. **Hàm thuần, không I/O** | `main` | Test: chọn đúng theo `dueOn`; hai ngày liên tiếp ra khác nhau; box chỉ tăng khi có `spoken: true` |
| 1.10 | `services/notifier/src/lesson.mjs` viết lại → `async buildLesson()`; giữ `[TEST]` prefix; ghi `LESSON#<date>` | `main` | Test cũ về `[TEST]` và timezone vẫn xanh |
| 1.11 | `handler.mjs` — **đúng một dòng** (`await buildLesson()`), không đụng gì khác | `main` | `git diff --stat services/notifier/src/handler.mjs` = 1 dòng đổi |
| 1.12 | Cập nhật 3 call site của `buildMessage`: `handler.mjs`, `scripts/send-now.mjs`, `test/notifier.test.mjs` | `main` | `node --test` xanh, **gồm cả token-leak assertions** (đỏ ở đó là security regression, không phải flaky) |
| 1.13 | Test mới: SRS chọn đúng; `[TEST]` sống sót; **fallback khi DynamoDB ném lỗi vẫn ra message** | `main` | `node --test` xanh |
| 1.14 | ~~`scripts/seed-curriculum.mjs`~~ — **removed, not needed.** See ADR 0010's Consequences: the table only holds per-word SRS state, created lazily on first selection; the curriculum ships inside the Lambda artifact and is read from disk. Nothing to seed. | — | — |
| 1.15 | `docs/aws-permissions.json` — thêm block DynamoDB (gồm cả `DescribeTable` để CloudFormation đọc lại) | `main` | Deploy không rollback vì permission |
| 1.16 | **Deploy + verify thật** | `main` + `skill deploy` | `/deploy in 8m` → `[TEST]` message có **từ vựng thật** tới máy; hôm sau kiểm tra nội dung **khác** ngày trước. Rollback ⇒ dùng `skill cfn-deploy-triage` (đọc event của **nested** stack). Không tới ⇒ `skill telegram-bot-ops` |
| 1.17 | `node scripts/record-run-history.mjs` sau mỗi lần fire | `main` | Row mới trong `docs/RUN-HISTORY.md` |
| 1.18 | Đóng backlog 0001 — ghi rõ lệnh nào đã chạy và in ra gì, không phải "có vẻ ổn" | `ck` | Ticket `State: done`, STATUS cập nhật |

### Phase 2.2 — Kênh trả lời (backlog 0003)

| # | Task | Owner | Done when |
|---|---|---|---|
| 2.1 | **ADR 0011** — webhook auth: `secret_token` + chat allowlist + **vì sao update bị từ chối vẫn trả 200** | `ck` | index + STATUS cập nhật |
| 2.2 | Tạo `secret_token` ngẫu nhiên, đặt vào SSM SecureString `/english-reminder/telegram-webhook-secret` | `user` | `aws ssm describe-parameters` thấy tên, **không in giá trị** |
| 2.3 | `services/coach/template.yaml` — `HttpApi` + `IngestFunction` + LogGroup tường minh + IAM scoped | `main` | Hook xanh |
| 2.4 | Root template + `docs/aws-permissions.json` (apigateway create **và** read-back) | `main` | Deploy không rollback |
| 2.5 | `services/coach/src/telegram.mjs` — copy client, thêm `getFile`/`answerCallbackQuery`/`sendChatAction`. Giữ nguyên quy tắc: error dựng từ **tên method**, không bao giờ từ URL | `main` | Test token-leak cho bản copy cũng xanh |
| 2.6 | Ingest handler — verify secret, allowlist chat, luôn 200, log JSON một dòng | `main` | Test: sai secret → 200 + log `webhook.rejected`, không xử lý gì |
| 2.6b | **Khử trùng lặp theo `update_id`** — ghi có điều kiện `UPDATE#<update_id>` (TTL 24h). Telegram gửi lại update khi không nhận 200 kịp; không có bước này thì một voice note ⇒ hai job + hai tin feedback | `main` | Test: gửi cùng một update hai lần ⇒ lần hai log `webhook.duplicate` và không làm gì |
| 2.7 | Inline keyboard: `lesson.mjs` trả `replyMarkup`, `telegram.mjs` nhận tham số thứ tư optional | `main` | Test cũ (không truyền tham số 4) vẫn ra body y hệt |
| 2.8 | `services/coach/scripts/set-webhook.mjs` — chỉ gọi Telegram API, **không cần AWS credentials**, nhận API URL qua argv | `main` | Chạy được với `node ... <url>`; `getWebhookInfo` xác nhận |
| 2.9 | Mở rộng skill `telegram-bot-ops`: webhook, `secret_token`, `getFile`, voice note, vì sao trả 200 khi từ chối | `ck` | Skill có mục mới; không lặp nội dung ADR |
| 2.10 | **Verify thật**: bấm từng nút, gửi text, và gửi một update **sai secret** | `main` | Cả ba hành vi đúng như log; latency ingest < 3 s |

### Phase 2.3 — Speaking, **vẫn chưa LLM** (backlog 0004)

| # | Task | Owner | Done when |
|---|---|---|---|
| 3.1 | `AudioBucket` (block public, SSE-S3, lifecycle 30 ngày) + IAM Transcribe + `TranscribeDoneRule` | `main` | Hook xanh; rule khớp `aws.transcribe` / `Transcribe Job State Change` |
| 3.2 | Ingest: voice → `getFile` → S3 → `StartTranscriptionJob` (`ogg`, `en-US`) → ack. Tên job = `<env>-<chatId>-<YYYYMMDD>-<update_id>` — EventBridge chỉ đưa tên job cho `GradeFunction`, nên tên **là** khoá tra ngược | `main` | Job xuất hiện trong `aws transcribe list-transcription-jobs`; `GradeFunction` tra ngược được `LESSON#<date>` chỉ từ tên job |
| 3.3 | `services/coach/src/metrics.mjs` — **hàm thuần**: WPM, filler count, từ đích đã dùng, từ confidence thấp, và WER so câu đích cho `shadow` | `main` | Test với transcript mẫu cố định; đây là các con số **không hallucinate**, phải có test dày |
| 3.4 | `GradeFunction` — ghép metric + `LESSON#<date>`, cập nhật SRS box, ghi `SUB#`, gửi feedback | `main` | Từ chỉ lên box khi `spoken: true` (invariant ADR 0010) |
| 3.5 | **Verify thật**: gửi voice note từ máy | `main` | Nhận lại transcript + số liệu; đo và **ghi lại** latency thật, không hứa suông |
| 3.6 | ADR: Transcribe đo intelligibility **không** đo phoneme; seam `assess.mjs` cho provider phoneme sau này | `ck` | ADR nêu rõ giới hạn, tránh phóng đại |

### Phase 2.4 — LLM coaching (backlog 0005)

| # | Task | Owner | Done when |
|---|---|---|---|
| 4.0 | **Probe trước, quyết sau**: deploy một Lambda thử import `@aws-sdk/client-bedrock-runtime` và in version. Nếu không có trong runtime ⇒ Bedrock buộc phải đóng gói client ⇒ va vào ADR 0001 | `main` | Kết quả in ra từ một invocation thật, không phải suy đoán |
| 4.1 | **ADR** chốt provider + model theo job (a/b/c), kèm bảng giá **có URL**, kết quả probe 4.0, lý do loại batch inference, **và quy tắc "delivery không bao giờ phụ thuộc LLM"** | `ck` | Không có con số nào không nguồn; ADR ghi rõ số nào chưa xác minh được |
| 4.2 | Secret (API key hoặc chỉ IAM role nếu Bedrock) vào SSM SecureString | `user` | Không in giá trị ra transcript |
| 4.3 | `llm.mjs` — **một interface duy nhất**, gọi bằng `fetch` built-in (Claude API) hoặc SDK lazy-import (Bedrock); model là hằng số cấu hình theo job | `main` | Đổi model chỉ đụng một hằng số; zero npm dependency vẫn đúng (hoặc ADR 0001 đã được mở lại tường minh) |
| 4.4 | Prompt cho 3 job, **prefix ổn định để prompt caching ăn** (giảm tới 90% input cost) | `main` | Prefix không chứa timestamp / id thay đổi mỗi request |
| 4.5 | **Fallback path** — LLM lỗi ⇒ dùng `curriculum.json`, message vẫn gửi | `main` | Test bằng key sai; bài 21:00 **vẫn tới máy** |
| 4.6 | Tích hợp vào `lesson.mjs` và `GradeFunction` | `main` | Feedback định tính tới máy |

### Phase 2.5 — Digest + tinh chỉnh (backlog 0006)

| # | Task | Owner | Done when |
|---|---|---|---|
| 5.1 | `DigestFunction` + `ScheduleV2` `cron(0 21 ? * SUN *)`, `Asia/Ho_Chi_Minh` | `main` | `aws scheduler get-schedule` xác nhận expression + timezone |
| 5.2 | Tỉ lệ dùng chủ động, 3 lỗi lặp nhiều nhất, mock interview 3 câu | `main` | Digest Chủ nhật tới máy |
| 5.3 | Tinh chỉnh tỉ lệ work/daily/pronunciation theo `PROFILE` | `main` | Đổi được bằng dữ liệu, không cần redeploy |
| 5.4 | Audit toàn bộ tài liệu vs code sau khi Phase 2 xong | `ck` | Báo lại chỗ nào lệch; xoá rule nào đã chết |

---

## 5. Verification

Theo `CLAUDE.md` — *"Don't claim it works until it ran"*:

```sh
node --test                                    # từ project root; dạng thư mục trần fail
sam validate --lint --region ap-southeast-1
sam build                                      # phải liệt kê đủ function của cả 3 stack
```

Deploy qua `/deploy` (skill đã xử lý đúng bẫy one-shot `at(...)` trong quá khứ **và**
bẫy `TestScheduleState` bị CloudFormation tái dùng giá trị cũ). Sau mỗi lần fire chạy
`node scripts/record-run-history.mjs`. Rollback ⇒ `cfn-deploy-triage`. Message không
tới ⇒ `telegram-bot-ops` trước khi nghi ngờ AWS.

## 6. Ghi chú cho người thực thi

`convention-keeper` là subagent **duy nhất** được sửa `CLAUDE.md`, `.claude/rules/`,
`docs/decisions/` và `docs/STATUS.md`. Nó cũng là nơi phát số ADR/ticket. Không tự
sửa tay bốn surface đó — số sẽ trùng và index sẽ lệch, đúng kiểu lỗi đang có ở task 0.1.

**Cách làm việc trong dự án này** (yêu cầu của chủ dự án, 2026-08-24): chia việc thành
task nhỏ có checklist kiểm chứng được, và giao cho subagent đã được định nghĩa sẵn
trong `.claude/` thay vì tự làm hết trong một session.

## 7. Thứ tự bắt đầu

**Task 0.5 đã xong** — file này chính là bản trong repo, và nó là nguồn sự thật. Bản
ở `~/.claude/plans/` là bản nháp đã bỏ; đừng sửa ở đó nữa.

1. **Task 0.1** — `convention-keeper` audit và sửa `docs/STATUS.md`: số ADR kế tiếp
   thật là **0009**, không phải 0008 như STATUS đang nói. Phải xong trước mọi ADR,
   nếu không ADR mới sẽ lấy số trùng.
2. **Task 0.4** — mở backlog `0003`–`0006` từ Phase 2.2–2.5. Sau bước này việc đã nằm
   trên board trong git, không chỉ trong một file plan.
3. **Task 0.2** — commit 4 file đang dirty, để diff của Phase 2 sạch.
4. Rồi mới vào **Phase 2.1**, bắt đầu ở task 1.1 (ADR seam mới) — **không** bắt đầu ở
   storage layer, đúng như backlog 0001 dặn.

Task 0.3 (xoay bot token) là việc của bạn, làm lúc nào cũng được nhưng trước khi
repo được chia sẻ.

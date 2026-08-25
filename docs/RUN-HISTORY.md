# Run history

Every invocation of the reminder, oldest first. **This file is the durable
record**: the CloudWatch log groups keep only 30 days, so a run that is not
copied here before it expires is lost for good.

Generated -- do not hand-edit rows. Refresh it with:

```
node scripts/record-run-history.mjs
```

That merges anything new and never rewrites or removes an existing row, so rows
older than CloudWatch's retention stay put. Times are Asia/Ho_Chi_Minh.

- **trigger** -- `scheduled` means EventBridge Scheduler fired it. `manual` means a
  hand-run `lambda invoke`, which is **not** evidence the schedule works.
- **outcome** -- `sent` carries the Telegram message id; `FAILED` carries Telegram's
  own explanation.

For deploys rather than runs, see `docs/DEPLOY-LOG.md`.

| When (VN) | Env | Trigger | Outcome | Detail | Duration | Request id |
|---|---|---|---|---|---|---|
| 2026-08-23 13:42:36 | test | manual | sent | message 5 | 4264 ms | 4c21ec6c-434c-4ffb-a11a-9c28e6ef9202 |
| 2026-08-23 13:42:53 | prod | manual | sent | message 6 | 3878 ms | 3f6256d4-639c-48f3-bd60-fccc6b4b062e |
| 2026-08-23 13:49:36 | test | scheduled | sent | message 7 | 3812 ms | 016a8a97-dc86-41bf-9fc6-1269dab1a2ca |
| 2026-08-23 21:00:06 | prod | scheduled | sent | message 8 | 2836 ms | e76a8afc-e032-4d21-842e-7244b7cbc3e2 |
| 2026-08-24 09:00:36 | test | scheduled | sent | message 9 | 4060 ms | 886a8ba5-a0ac-4995-9bc2-4326d8973f25 |
| 2026-08-24 21:00:06 | prod | scheduled | sent | message 10 | 3989 ms | e76a8c4e-6032-4d21-842e-7244b7cbc3e2 |
| 2026-08-25 21:00:06 | prod | scheduled | sent | message 11 | 4190 ms | e76a8d9f-e032-4d21-842e-7244b7cbc3e2 |
| 2026-08-25 21:11:36 | test | scheduled | sent | message 12 | 4620 ms | dc6a8da2-74d4-4e50-aca6-7cea489165f8 |
| 2026-08-25 21:21:36 | test | scheduled | sent | message 13 | 4741 ms | 426a8da4-cca5-49b7-975d-5c690e60fdd5 |
| 2026-08-25 21:36:36 | test | scheduled | sent | message 14 | 4694 ms | 1f6a8da8-50db-4447-af4c-a000cc5f13ad |
| 2026-08-25 21:50:36 | test | scheduled | sent | message 15 | 4783 ms | bb6a8dab-98fe-4ca9-a741-b6cfb46a8559 |

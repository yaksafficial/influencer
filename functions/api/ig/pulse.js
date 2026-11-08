// 새 댓글·DM 이 들어왔는지 가볍게 확인 (화면이 10초마다 호출)
// 웹훅이 받을 때마다 갱신하는 시각 2개만 읽는다 → D1 2행 읽기
import { json } from './_lib.js';

export async function onRequestGet(context) {
  const rows = await context.env.DB.prepare(
    "SELECT key, value FROM settings WHERE key IN ('webhook_last_comment_at', 'webhook_last_message_at')"
  ).all();
  const v = Object.fromEntries(rows.results.map((r) => [r.key, Number(r.value) || 0]));
  return json({ ok: true, c: v.webhook_last_comment_at || 0, m: v.webhook_last_message_at || 0 });
}

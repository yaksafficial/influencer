// 활동 로그 조회
import { json } from './_lib.js';

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 500);
  const rows = await context.env.DB.prepare('SELECT * FROM activity_log ORDER BY id DESC LIMIT ?').bind(limit).all();
  return json({ ok: true, log: rows.results });
}

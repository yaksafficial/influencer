// 자료 킷(정리본) CRUD
import { json, error, readJson, now, logActivity } from './_lib.js';

const TYPES = new Set(['image', 'video', 'audio', 'file']);

export async function onRequestGet(context) {
  const rows = await context.env.DB.prepare(`
    SELECT k.*, (SELECT COUNT(*) FROM comments c WHERE c.private_reply_kit_id = k.id) AS sent_count
    FROM dm_kits k ORDER BY k.id DESC
  `).all();
  return json({ ok: true, kits: rows.results });
}

function validate(b) {
  const name = String(b.name || '').trim();
  const text = String(b.text || '').trim();
  if (!name) return '이름을 입력하세요.';
  if (!text) return '본문을 입력하세요.';
  if (text.length > 1000) return '본문은 1000자 이내로 입력하세요.';
  const url = String(b.attachment_url || '').trim();
  if (url && !/^https:\/\//.test(url)) return '첨부 URL 은 https:// 로 시작하는 공개 URL 이어야 합니다.';
  if (url && !TYPES.has(b.attachment_type)) return '첨부 종류(image/video/audio/file)를 선택하세요.';
  return null;
}

export async function onRequestPost(context) {
  const { env } = context;
  const b = await readJson(context.request);
  const bad = validate(b);
  if (bad) return error(bad);
  const url = String(b.attachment_url || '').trim() || null;
  const r = await env.DB.prepare(`
    INSERT INTO dm_kits (name, text, attachment_url, attachment_type, keyword, created_at) VALUES (?, ?, ?, ?, ?, ?)
  `).bind(b.name.trim(), b.text.trim(), url, url ? b.attachment_type : null, String(b.keyword || '').trim() || null, now()).run();
  await logActivity(env.DB, context.data.session.name, 'kit_create', 'kit', String(r.meta.last_row_id), b.name);
  return json({ ok: true, id: r.meta.last_row_id });
}

export async function onRequestPut(context) {
  const { env } = context;
  const b = await readJson(context.request);
  if (!b.id) return error('id 가 필요합니다.');
  const bad = validate(b);
  if (bad) return error(bad);
  const url = String(b.attachment_url || '').trim() || null;
  await env.DB.prepare(`
    UPDATE dm_kits SET name = ?, text = ?, attachment_url = ?, attachment_type = ?, keyword = ?, updated_at = ? WHERE id = ?
  `).bind(b.name.trim(), b.text.trim(), url, url ? b.attachment_type : null, String(b.keyword || '').trim() || null, now(), Number(b.id)).run();
  await logActivity(env.DB, context.data.session.name, 'kit_update', 'kit', String(b.id), b.name);
  return json({ ok: true });
}

export async function onRequestDelete(context) {
  const { env } = context;
  if (context.data.session.role !== 'owner') return error('삭제는 owner 만 가능합니다.', 403);
  const id = Number(new URL(context.request.url).searchParams.get('id'));
  if (!id) return error('id 가 필요합니다.');
  await env.DB.prepare('UPDATE media SET dm_kit_id = NULL WHERE dm_kit_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM dm_kits WHERE id = ?').bind(id).run();
  await logActivity(env.DB, context.data.session.name, 'kit_delete', 'kit', String(id));
  return json({ ok: true });
}

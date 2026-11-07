// 댓글에 공개 답글 달기 / 댓글 숨기기
import { json, error, readJson, getAccount, refreshTokenIfNeeded, igFetch, now, logActivity } from '../_lib.js';

// POST /api/ig/comments/reply { comment_id, text }
export async function onRequestPost(context) {
  const { env } = context;
  const db = env.DB;
  const { comment_id, text } = await readJson(context.request);
  const msg = String(text || '').trim();
  if (!comment_id || !msg) return error('comment_id 와 text 가 필요합니다.');

  let account = await getAccount(db);
  if (!account) return error('Instagram 계정이 연결되지 않았습니다.', 409);
  account = await refreshTokenIfNeeded(env, db, account);

  const parent = await db.prepare('SELECT media_id FROM comments WHERE id = ?').bind(String(comment_id)).first();

  let res;
  try {
    res = await igFetch(env, account, `/${comment_id}/replies`, { method: 'POST', params: { message: msg } });
  } catch (e) {
    return error(`답글 실패: ${e.message}`, 502, { payload: e.payload });
  }

  const who = context.data.session.name;
  const ts = now();
  if (res && res.id) {
    await db.prepare(`
      INSERT OR IGNORE INTO comments (id, media_id, parent_id, from_user_id, from_username, text, timestamp, is_mine, status, handled_by, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'done', ?, 'app', ?)
    `).bind(String(res.id), parent ? parent.media_id : null, String(comment_id), String(account.ig_user_id), account.username, msg, ts, who, ts).run();
  }
  await db.prepare("UPDATE comments SET replied_at = ?, status = 'done', handled_by = ? WHERE id = ?").bind(ts, who, String(comment_id)).run();
  await logActivity(db, who, 'comment_reply', 'comment', String(comment_id), msg);
  return json({ ok: true, reply_id: res && res.id });
}

// PATCH /api/ig/comments/reply { comment_id, hide: true|false }
export async function onRequestPatch(context) {
  const { env } = context;
  const { comment_id, hide } = await readJson(context.request);
  if (!comment_id) return error('comment_id 가 필요합니다.');
  let account = await getAccount(env.DB);
  if (!account) return error('Instagram 계정이 연결되지 않았습니다.', 409);
  account = await refreshTokenIfNeeded(env, env.DB, account);
  try {
    await igFetch(env, account, `/${comment_id}`, { method: 'POST', params: { hide: hide ? 'true' : 'false' } });
  } catch (e) {
    return error(`숨기기 실패: ${e.message}`, 502, { payload: e.payload });
  }
  await logActivity(env.DB, context.data.session.name, hide ? 'comment_hide' : 'comment_unhide', 'comment', String(comment_id));
  return json({ ok: true });
}

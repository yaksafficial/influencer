// Private Reply: 댓글 작성자에게 DM 으로 자료(킷) 발송
// 제약(Meta 강제): 댓글 1건당 1회, 댓글 작성 후 7일 이내.
import { json, error, readJson, getAccount, refreshTokenIfNeeded, igFetch, now, logActivity } from '../_lib.js';

const SEVEN_DAYS = 7 * 24 * 3600 * 1000;

async function sendOne(env, db, account, comment, kit, customText, who) {
  if (comment.private_reply_sent_at) return { id: comment.id, ok: false, reason: '이미 발송된 댓글입니다.' };
  if (now() - comment.timestamp > SEVEN_DAYS) return { id: comment.id, ok: false, reason: '댓글 작성 후 7일이 지나 발송할 수 없습니다.' };
  if (comment.is_mine) return { id: comment.id, ok: false, reason: '내 댓글에는 보낼 수 없습니다.' };

  const text = (customText || (kit && kit.text) || '').trim();
  if (!text) return { id: comment.id, ok: false, reason: '보낼 내용이 없습니다.' };

  const base = `/${account.ig_user_id}/messages`;
  let mode = 'text';
  let result = null;
  let lastErr = null;

  // 1순위: 첨부가 설정된 킷이면 첨부로 시도
  if (kit && kit.attachment_url && kit.attachment_type) {
    try {
      result = await igFetch(env, account, base, {
        method: 'POST',
        body: { recipient: { comment_id: comment.id }, message: { attachment: { type: kit.attachment_type, payload: { url: kit.attachment_url } } } },
      });
      mode = 'attachment';
    } catch (e) {
      lastErr = e;
      result = null;
    }
  }
  // 2순위(또는 기본): 텍스트(링크 포함)
  if (!result) {
    try {
      result = await igFetch(env, account, base, {
        method: 'POST',
        body: { recipient: { comment_id: comment.id }, message: { text } },
      });
      mode = 'text';
    } catch (e) {
      lastErr = e;
      return { id: comment.id, ok: false, reason: e.message, payload: e.payload, attachment_error: lastErr && lastErr !== e ? lastErr.message : undefined };
    }
  }

  const ts = now();
  await db.prepare(`
    UPDATE comments SET private_reply_sent_at = ?, private_reply_kit_id = ?, private_reply_by = ?, private_reply_mode = ?, status = 'done', handled_by = ?
    WHERE id = ?
  `).bind(ts, kit ? kit.id : null, who, mode, who, comment.id).run();

  // 내 DM 기록에도 남겨 둔다 (상대가 답하면 대화가 이어짐)
  if (comment.from_user_id) {
    const mid = (result && result.message_id) || `pr-${comment.id}`;
    await db.prepare(`
      INSERT OR IGNORE INTO messages (id, participant_id, direction, text, attachments, timestamp, sent_by, source, created_at)
      VALUES (?, ?, 'out', ?, ?, ?, ?, 'app', ?)
    `).bind(mid, comment.from_user_id, mode === 'attachment' ? `[자료 첨부] ${kit.name}` : text,
      mode === 'attachment' ? JSON.stringify([{ type: kit.attachment_type, payload: { url: kit.attachment_url } }]) : null, ts, who, ts).run();
    await db.prepare(`
      INSERT INTO conversations (participant_id, participant_username, last_message_at, last_text, unread, status, updated_at)
      VALUES (?, ?, ?, ?, 0, 'open', ?)
      ON CONFLICT(participant_id) DO UPDATE SET
        participant_username = COALESCE(conversations.participant_username, excluded.participant_username),
        last_message_at = MAX(COALESCE(conversations.last_message_at, 0), excluded.last_message_at),
        last_text = excluded.last_text, updated_at = excluded.updated_at
    `).bind(comment.from_user_id, comment.from_username || null, ts, mode === 'attachment' ? `[자료 첨부] ${kit.name}` : text, ts).run();
  }

  await logActivity(db, who, 'private_reply', 'comment', comment.id, `${kit ? kit.name : '직접 입력'} (${mode})${lastErr ? ' / 첨부 실패→텍스트' : ''}`);
  return { id: comment.id, ok: true, mode, message_id: result && result.message_id, attachment_fallback: !!lastErr };
}

// POST /api/ig/comments/private-reply { comment_ids: [...], kit_id?, text? }
export async function onRequestPost(context) {
  const { env } = context;
  const db = env.DB;
  const body = await readJson(context.request);
  const ids = Array.isArray(body.comment_ids) ? body.comment_ids.map(String) : body.comment_id ? [String(body.comment_id)] : [];
  if (!ids.length) return error('comment_ids 가 필요합니다.');
  if (ids.length > 50) return error('한 번에 최대 50건까지 발송할 수 있습니다.');

  let account = await getAccount(db);
  if (!account) return error('Instagram 계정이 연결되지 않았습니다.', 409);
  account = await refreshTokenIfNeeded(env, db, account);

  let kit = null;
  if (body.kit_id) {
    kit = await db.prepare('SELECT * FROM dm_kits WHERE id = ?').bind(Number(body.kit_id)).first();
    if (!kit) return error('자료(킷)를 찾을 수 없습니다.', 404);
  }
  if (!kit && !String(body.text || '').trim()) return error('kit_id 또는 text 중 하나는 필요합니다.');

  const who = context.data.session.name;
  const results = [];
  for (const id of ids) {
    const c = await db.prepare('SELECT * FROM comments WHERE id = ?').bind(id).first();
    if (!c) { results.push({ id, ok: false, reason: '댓글을 찾을 수 없습니다.' }); continue; }
    results.push(await sendOne(env, db, account, c, kit, body.text, who));
  }
  const sent = results.filter((r) => r.ok).length;
  return json({ ok: true, sent, failed: results.length - sent, results });
}

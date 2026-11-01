// DM 전송 (24시간 윈도우 내에서만 Meta 가 허용)
import { json, error, readJson, getAccount, refreshTokenIfNeeded, igFetch, now, logActivity } from '../_lib.js';

// POST /api/ig/messages/send { participant_id, text?, kit_id? }
export async function onRequestPost(context) {
  const { env } = context;
  const db = env.DB;
  const { participant_id, text, kit_id } = await readJson(context.request);
  if (!participant_id) return error('participant_id 가 필요합니다.');

  let account = await getAccount(db);
  if (!account) return error('Instagram 계정이 연결되지 않았습니다.', 409);
  account = await refreshTokenIfNeeded(env, db, account);

  let kit = null;
  if (kit_id) {
    kit = await db.prepare('SELECT * FROM dm_kits WHERE id = ?').bind(Number(kit_id)).first();
    if (!kit) return error('자료(킷)를 찾을 수 없습니다.', 404);
  }
  const msg = String(text || (kit && kit.text) || '').trim();
  if (!msg && !(kit && kit.attachment_url)) return error('보낼 내용이 없습니다.');

  const conv = await db.prepare('SELECT last_inbound_at FROM conversations WHERE participant_id = ?').bind(String(participant_id)).first();
  const windowOpen = conv && conv.last_inbound_at && now() - conv.last_inbound_at < 24 * 3600 * 1000;

  const who = context.data.session.name;
  const base = `/${account.ig_user_id}/messages`;
  const sent = [];
  try {
    if (kit && kit.attachment_url && kit.attachment_type) {
      const r = await igFetch(env, account.access_token, base, {
        method: 'POST',
        body: { recipient: { id: String(participant_id) }, message: { attachment: { type: kit.attachment_type, payload: { url: kit.attachment_url } } } },
      });
      sent.push({ mid: r.message_id, text: `[자료 첨부] ${kit.name}`, attachments: [{ type: kit.attachment_type, payload: { url: kit.attachment_url } }] });
    }
    if (msg) {
      const r = await igFetch(env, account.access_token, base, {
        method: 'POST',
        body: { recipient: { id: String(participant_id) }, message: { text: msg } },
      });
      sent.push({ mid: r.message_id, text: msg, attachments: null });
    }
  } catch (e) {
    const code = e.payload && e.payload.error && e.payload.error.code;
    const hint = !windowOpen
      ? '상대가 마지막으로 메시지를 보낸 지 24시간이 지났을 수 있습니다. 상대가 다시 메시지를 보내야 답장할 수 있습니다.'
      : undefined;
    return error(`전송 실패: ${e.message}`, 502, { payload: e.payload, code, hint, partial: sent.length });
  }

  const ts = now();
  for (const s of sent) {
    await db.prepare(`
      INSERT OR IGNORE INTO messages (id, participant_id, direction, text, attachments, timestamp, sent_by, source, created_at)
      VALUES (?, ?, 'out', ?, ?, ?, ?, 'app', ?)
    `).bind(s.mid || `app-${ts}-${Math.random().toString(36).slice(2, 8)}`, String(participant_id), s.text, s.attachments ? JSON.stringify(s.attachments) : null, ts, who, ts).run();
  }
  const lastText = sent[sent.length - 1].text;
  await db.prepare(`
    INSERT INTO conversations (participant_id, last_message_at, last_text, unread, status, updated_at)
    VALUES (?, ?, ?, 0, 'open', ?)
    ON CONFLICT(participant_id) DO UPDATE SET last_message_at = excluded.last_message_at, last_text = excluded.last_text, unread = 0, updated_at = excluded.updated_at
  `).bind(String(participant_id), ts, lastText, ts).run();
  await logActivity(db, who, 'dm_send', 'conversation', String(participant_id), lastText);
  return json({ ok: true, sent: sent.length, window_open: !!windowOpen });
}

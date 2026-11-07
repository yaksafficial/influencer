// DM 대화 목록 / 스레드 메시지 / API 동기화 / 상태·담당자 변경
import { json, error, readJson, getAccount, refreshTokenIfNeeded, igFetch, toMs, now, logActivity, fetchProfile } from './_lib.js';

const CONV_FIELDS = 'id,updated_time,participants,messages.limit(20){id,created_time,from,to,message,attachments}';

// GET /api/ig/conversations                      → 목록 (status=open|done|all, filter=unread|window|follower|nonfollower)
// GET /api/ig/conversations?participant_id=X     → 해당 스레드 메시지 (읽음 처리)
// GET /api/ig/conversations?sync=1               → API 동기화 후 목록
export async function onRequestGet(context) {
  const { env } = context;
  const db = env.DB;
  const url = new URL(context.request.url);
  const participantId = url.searchParams.get('participant_id');

  if (participantId) {
    const conv = await db.prepare('SELECT * FROM conversations WHERE participant_id = ?').bind(participantId).first();
    if (!conv) return error('대화를 찾을 수 없습니다.', 404);
    const msgs = await db.prepare('SELECT * FROM messages WHERE participant_id = ? ORDER BY timestamp ASC LIMIT 300').bind(participantId).all();
    await db.prepare('UPDATE conversations SET unread = 0 WHERE participant_id = ?').bind(participantId).run();
    if (!conv.participant_username) {
      const account = await getAccount(db);
      context.waitUntil(fetchProfile(env, account, participantId));
    }
    return json({ ok: true, conversation: conv, messages: msgs.results, now: now() });
  }

  if (url.searchParams.get('sync') === '1') {
    let account = await getAccount(db);
    if (!account) return error('Instagram 계정이 연결되지 않았습니다.', 409);
    account = await refreshTokenIfNeeded(env, db, account);
    const myId = String(account.ig_user_id);
    let synced = 0;
    try {
      const data = await igFetch(env, account, `/${account.ig_user_id}/conversations`, { params: { platform: 'instagram', fields: CONV_FIELDS, limit: 50 } });
      for (const conv of data.data || []) {
        const participants = (conv.participants && conv.participants.data) || [];
        const other = participants.find((p) => String(p.id) !== myId) || participants[0];
        if (!other) continue;
        const pid = String(other.id);
        const msgs = (conv.messages && conv.messages.data) || [];
        let lastInbound = null;
        let lastAt = toMs(conv.updated_time);
        let lastText = null;
        for (const m of msgs) {
          const fromId = m.from ? String(m.from.id) : '';
          const dir = fromId === myId ? 'out' : 'in';
          const when = toMs(m.created_time) || now();
          const atts = m.attachments && m.attachments.data ? JSON.stringify(m.attachments.data) : null;
          await db.prepare(`
            INSERT OR IGNORE INTO messages (id, participant_id, direction, text, attachments, timestamp, source, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'sync', ?)
          `).bind(String(m.id), pid, dir, m.message || '', atts, when, now()).run();
          if (dir === 'in' && (!lastInbound || when > lastInbound)) lastInbound = when;
          if (lastText === null) lastText = m.message || (atts ? '(첨부)' : '');
          if (!lastAt || when > lastAt) lastAt = when;
        }
        await db.prepare(`
          INSERT INTO conversations (participant_id, api_conversation_id, participant_username, last_message_at, last_inbound_at, last_text, unread, status, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 0, 'open', ?)
          ON CONFLICT(participant_id) DO UPDATE SET
            api_conversation_id = excluded.api_conversation_id,
            participant_username = COALESCE(excluded.participant_username, conversations.participant_username),
            last_message_at = MAX(COALESCE(conversations.last_message_at, 0), COALESCE(excluded.last_message_at, 0)),
            last_inbound_at = MAX(COALESCE(conversations.last_inbound_at, 0), COALESCE(excluded.last_inbound_at, 0)),
            last_text = COALESCE(excluded.last_text, conversations.last_text),
            updated_at = excluded.updated_at
        `).bind(pid, String(conv.id), other.username || null, lastAt, lastInbound, lastText, now()).run();
        synced++;
      }
    } catch (e) {
      return error(`DM 동기화 실패: ${e.message}`, 502, { payload: e.payload });
    }
    await logActivity(db, context.data.session.name, 'sync_conversations', null, null, `${synced}건`);
  }

  const status = url.searchParams.get('status') || 'open';
  const filter = url.searchParams.get('filter') || '';
  const where = [];
  const binds = [];
  if (status !== 'all') { where.push('status = ?'); binds.push(status); }
  if (filter === 'unread') where.push('unread > 0');
  if (filter === 'window') { where.push('last_inbound_at > ?'); binds.push(now() - 24 * 3600 * 1000); }
  if (filter === 'follower') where.push('is_follower = 1');
  if (filter === 'nonfollower') where.push('is_follower = 0');
  if (filter === 'mine') { where.push('assigned_to = ?'); binds.push(context.data.session.name); }

  const rows = await db.prepare(`
    SELECT * FROM conversations ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY COALESCE(last_message_at, updated_at, 0) DESC LIMIT 300
  `).bind(...binds).all();
  return json({ ok: true, conversations: rows.results, now: now() });
}

// PATCH /api/ig/conversations { participant_id, status?, assigned_to?, note? }
export async function onRequestPatch(context) {
  const { env } = context;
  const b = await readJson(context.request);
  if (!b.participant_id) return error('participant_id 가 필요합니다.');
  const sets = [];
  const binds = [];
  if (b.status && ['open', 'done'].includes(b.status)) { sets.push('status = ?'); binds.push(b.status); }
  if ('assigned_to' in b) { sets.push('assigned_to = ?'); binds.push(b.assigned_to || null); }
  if ('note' in b) { sets.push('note = ?'); binds.push(b.note || null); }
  if (!sets.length) return error('변경할 항목이 없습니다.');
  sets.push('updated_at = ?'); binds.push(now());
  binds.push(String(b.participant_id));
  await env.DB.prepare(`UPDATE conversations SET ${sets.join(', ')} WHERE participant_id = ?`).bind(...binds).run();
  await logActivity(env.DB, context.data.session.name, 'conversation_update', 'conversation', String(b.participant_id), JSON.stringify(b));
  return json({ ok: true });
}

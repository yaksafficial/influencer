// DM 대화 목록 / 스레드 메시지 / API 동기화 / 상태·담당자 변경
import { json, error, readJson, getAccount, refreshTokenIfNeeded, igFetch, toMs, now, logActivity, fetchProfile, setSetting } from './_lib.js';

const LIST_LIMIT = 20; // Workers 무료 플랜 외부 호출 50회/요청 한도 고려
const MSG_FIELDS = 'id,created_time,from,to,message,attachments';

function errText(e) {
  const pe = e && e.payload && e.payload.error;
  return pe ? `${pe.message || e.message} (code ${pe.code}${pe.error_subcode ? '/' + pe.error_subcode : ''})` : String((e && e.message) || e);
}

// 대화 목록을 먼저 가져오고, 대화별 메시지는 따로 조회한다.
// 메시지 조회 방식은 첫 성공 방식을 이후에도 사용 (A: 대화 노드의 messages 필드, B: /messages 엣지, C: 메시지 ID별 상세)
async function syncConversations(env, db, account) {
  const myId = String(account.ig_user_id);
  const myName = account.username;
  const result = { ok: false, at: now(), host: account.api_host, conversations: 0, messages: 0, mode: null, errors: [] };

  let list;
  try {
    list = await igFetch(env, account, `/${myId}/conversations`, { params: { platform: 'instagram', fields: 'id,updated_time,participants', limit: LIST_LIMIT } });
  } catch (e) {
    result.errors.push(`대화 목록: ${errText(e)}`);
    return result;
  }
  result.ok = true;
  const convs = list.data || [];
  result.listed = convs.length;
  let mode = null;

  for (const conv of convs) {
    const participants = (conv.participants && conv.participants.data) || [];
    const other = participants.find((p) => String(p.id) !== myId && (!myName || p.username !== myName)) || null;
    if (!other) { result.errors.push(`대화 ${conv.id}: 상대 참가자를 찾지 못함`); continue; }
    const pid = String(other.id);

    let msgs = null;
    const tryModes = mode ? [mode] : ['A', 'B', 'C'];
    for (const m of tryModes) {
      try {
        if (m === 'A') {
          const d = await igFetch(env, account, `/${conv.id}`, { params: { fields: `messages.limit(20){${MSG_FIELDS}}` } });
          msgs = (d.messages && d.messages.data) || [];
        } else if (m === 'B') {
          const d = await igFetch(env, account, `/${conv.id}/messages`, { params: { fields: MSG_FIELDS, limit: 20 } });
          msgs = d.data || [];
        } else {
          const d = await igFetch(env, account, `/${conv.id}`, { params: { fields: 'messages.limit(10){id}' } });
          const ids = ((d.messages && d.messages.data) || []).map((x) => x.id);
          msgs = [];
          for (const id of ids.slice(0, 5)) {
            try { msgs.push(await igFetch(env, account, `/${id}`, { params: { fields: MSG_FIELDS } })); } catch (_) { /* 오래된 메시지는 상세 조회 불가 */ }
          }
        }
        mode = m;
        break;
      } catch (e) {
        if (result.errors.length < 8) result.errors.push(`메시지(${m}) ${conv.id}: ${errText(e)}`);
      }
    }
    result.mode = mode;

    let lastInbound = null;
    let lastAt = toMs(conv.updated_time);
    let lastText = null;
    for (const msg of msgs || []) {
      const fromId = msg.from ? String(msg.from.id) : '';
      const dir = fromId === myId || (myName && msg.from && msg.from.username === myName) ? 'out' : 'in';
      const when = toMs(msg.created_time) || now();
      const atts = msg.attachments && msg.attachments.data ? JSON.stringify(msg.attachments.data) : null;
      const r = await db.prepare(`
        INSERT OR IGNORE INTO messages (id, participant_id, direction, text, attachments, timestamp, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'sync', ?)
      `).bind(String(msg.id), pid, dir, msg.message || '', atts, when, now()).run();
      if (r.meta && r.meta.changes) result.messages++;
      if (dir === 'in' && (!lastInbound || when > lastInbound)) lastInbound = when;
      if (lastText === null) lastText = msg.message || (atts ? '(첨부)' : '');
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
    result.conversations++;
  }
  return result;
}

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
    const result = await syncConversations(env, db, account);
    await setSetting(db, 'dm_sync_last', JSON.stringify(result));
    if (!result.ok) {
      return error(`DM 동기화 실패: ${result.errors[0] || '알 수 없는 오류'}`, 502, { diagnostics: result });
    }
    await logActivity(db, context.data.session.name, 'sync_conversations', null, null,
      `${result.conversations}건 (메시지 ${result.messages}${result.errors.length ? `, 오류 ${result.errors.length}` : ''})`);
    context.data.syncResult = result;
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
  return json({ ok: true, conversations: rows.results, now: now(), sync: context.data.syncResult || undefined });
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

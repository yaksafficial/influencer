// Meta 웹훅 수신 엔드포인트 (공개 경로)
// GET  : 구독 검증 (hub.mode / hub.verify_token / hub.challenge)
// POST : comments / messages 이벤트 수신 → D1 저장. X-Hub-Signature-256 로 서명 검증.
import { verifyHubSignature, getAccount, setSetting, toMs, now, fetchProfile } from './_lib.js';

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  if (mode === 'subscribe' && token && token === context.env.IG_WEBHOOK_VERIFY_TOKEN) {
    return new Response(challenge || '', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  return new Response('Forbidden', { status: 403 });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const raw = await request.text();

  const ok = await verifyHubSignature(raw, request.headers.get('x-hub-signature-256'), env.IG_APP_SECRET);
  if (!ok) {
    await setSetting(env.DB, 'webhook_last_bad_signature_at', now());
    return new Response('Invalid signature', { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (_) {
    return new Response('Bad JSON', { status: 400 });
  }

  // Meta 는 빠른 200 응답을 요구. 처리 중 오류가 나도 200 을 돌려주고 기록만 남긴다.
  try {
    await handlePayload(context, payload);
  } catch (e) {
    await setSetting(env.DB, 'webhook_last_error', JSON.stringify({ at: now(), message: e.message, sample: raw.slice(0, 500) }));
  }
  return new Response('OK', { status: 200 });
}

async function handlePayload(context, payload) {
  const { env } = context;
  const db = env.DB;
  const account = await getAccount(db);
  const myId = account ? String(account.ig_user_id) : null;
  const ts = now();
  await setSetting(db, 'webhook_last_event_at', ts);

  if (payload.object !== 'instagram' || !Array.isArray(payload.entry)) return;

  for (const entry of payload.entry) {
    const entryId = String(entry.id || '');
    const entryTime = toMs(entry.time) || ts;

    // ── 댓글 ─────────────────────────────────────────
    for (const change of entry.changes || []) {
      if (change.field !== 'comments' || !change.value) continue;
      const v = change.value;
      const fromId = v.from && String(v.from.id || '');
      const isMine = (myId && fromId === myId) || fromId === entryId ? 1 : 0;
      await db.prepare(`
        INSERT OR IGNORE INTO comments
          (id, media_id, parent_id, from_user_id, from_username, text, timestamp, is_mine, status, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'webhook', ?)
      `).bind(
        String(v.id),
        v.media ? String(v.media.id) : null,
        v.parent_id ? String(v.parent_id) : null,
        fromId || null,
        v.from ? v.from.username || null : null,
        v.text || '',
        entryTime,
        isMine,
        isMine ? 'done' : 'open',
        ts
      ).run();
      // 게시물 행이 없으면 자리만 만들어 둔다 (나중에 media 동기화로 채움)
      if (v.media && v.media.id) {
        await db.prepare('INSERT OR IGNORE INTO media (id, synced_at) VALUES (?, NULL)').bind(String(v.media.id)).run();
      }
      await setSetting(db, 'webhook_last_comment_at', ts);
    }

    // ── DM ───────────────────────────────────────────
    for (const ev of entry.messaging || []) {
      if (!ev.message) continue; // read / reaction / postback 등은 무시
      const m = ev.message;
      const senderId = String((ev.sender && ev.sender.id) || '');
      const recipientId = String((ev.recipient && ev.recipient.id) || '');
      const isEcho = !!m.is_echo || (myId && senderId === myId) || senderId === entryId;
      const participantId = isEcho ? recipientId : senderId;
      if (!participantId) continue;
      const when = toMs(ev.timestamp) || ts;
      const attachments = Array.isArray(m.attachments) ? JSON.stringify(m.attachments) : null;
      const text = m.text || (m.is_deleted ? '(삭제된 메시지)' : m.is_unsupported ? '(지원되지 않는 형식)' : '');

      const inserted = await db.prepare(`
        INSERT OR IGNORE INTO messages (id, participant_id, direction, text, attachments, timestamp, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'webhook', ?)
      `).bind(String(m.mid || `${participantId}-${when}`), participantId, isEcho ? 'out' : 'in', text, attachments, when, ts).run();

      if (inserted.meta && inserted.meta.changes === 0) continue; // 중복 이벤트

      const existing = await db.prepare('SELECT participant_id, participant_username FROM conversations WHERE participant_id = ?')
        .bind(participantId).first();
      if (existing) {
        await db.prepare(`
          UPDATE conversations SET
            last_message_at = MAX(COALESCE(last_message_at, 0), ?),
            last_inbound_at = CASE WHEN ? = 'in' THEN MAX(COALESCE(last_inbound_at, 0), ?) ELSE last_inbound_at END,
            last_text = ?,
            unread = CASE WHEN ? = 'in' THEN unread + 1 ELSE unread END,
            status = CASE WHEN ? = 'in' THEN 'open' ELSE status END,
            updated_at = ?
          WHERE participant_id = ?
        `).bind(when, isEcho ? 'out' : 'in', when, text || (attachments ? '(첨부)' : ''), isEcho ? 'out' : 'in', isEcho ? 'out' : 'in', ts, participantId).run();
      } else {
        await db.prepare(`
          INSERT INTO conversations (participant_id, last_message_at, last_inbound_at, last_text, unread, status, updated_at)
          VALUES (?, ?, ?, ?, ?, 'open', ?)
        `).bind(participantId, when, isEcho ? null : when, text || (attachments ? '(첨부)' : ''), isEcho ? 0 : 1, ts).run();
      }

      if (!existing || !existing.participant_username) {
        context.waitUntil(fetchProfile(env, account, participantId));
      }
      await setSetting(db, 'webhook_last_message_at', ts);
    }
  }
}

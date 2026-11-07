// 댓글 목록 / API 동기화 / 상태 변경
import { json, error, readJson, getAccount, refreshTokenIfNeeded, igFetch, toMs, now, logActivity } from './_lib.js';

const COMMENT_FIELDS = 'id,text,timestamp,username,from{id,username},parent_id,hidden,replies{id,text,timestamp,username,from{id,username},parent_id}';

async function upsertComment(db, c, mediaId, myId, source) {
  const fromId = c.from ? String(c.from.id || '') : '';
  const isMine = myId && fromId === myId ? 1 : 0;
  await db.prepare(`
    INSERT INTO comments (id, media_id, parent_id, from_user_id, from_username, text, timestamp, is_mine, status, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      media_id = COALESCE(comments.media_id, excluded.media_id),
      from_username = COALESCE(excluded.from_username, comments.from_username),
      text = excluded.text,
      timestamp = excluded.timestamp
  `).bind(String(c.id), String(mediaId), c.parent_id ? String(c.parent_id) : null, fromId || null,
    (c.from && c.from.username) || c.username || null, c.text || '', toMs(c.timestamp) || now(),
    isMine, isMine ? 'done' : 'open', source, now()).run();
}

// GET /api/ig/comments?media_id=&status=open|done|all&sync=1&limit=
export async function onRequestGet(context) {
  const { env } = context;
  const db = env.DB;
  const url = new URL(context.request.url);
  const mediaId = url.searchParams.get('media_id');
  const status = url.searchParams.get('status') || 'open';
  const limit = Math.min(Number(url.searchParams.get('limit')) || 200, 500);

  if (url.searchParams.get('sync') === '1') {
    let account = await getAccount(db);
    if (!account) return error('Instagram 계정이 연결되지 않았습니다.', 409);
    account = await refreshTokenIfNeeded(env, db, account);
    const myId = String(account.ig_user_id);

    // 대상 게시물: 지정된 1개 또는 최근 20개
    let targets = [];
    if (mediaId) targets = [mediaId];
    else {
      const r = await db.prepare('SELECT id FROM media ORDER BY COALESCE(timestamp, 0) DESC LIMIT 20').all();
      targets = r.results.map((x) => x.id);
    }
    let synced = 0;
    for (const mid of targets) {
      try {
        const data = await igFetch(env, account, `/${mid}/comments`, { params: { fields: COMMENT_FIELDS, limit: 50 } });
        for (const c of data.data || []) {
          await upsertComment(db, c, mid, myId, 'sync');
          synced++;
          const replies = (c.replies && c.replies.data) || [];
          for (const r of replies) {
            await upsertComment(db, { ...r, parent_id: r.parent_id || c.id }, mid, myId, 'sync');
            synced++;
          }
        }
      } catch (e) {
        if (mediaId) return error(`댓글 동기화 실패: ${e.message}`, 502, { payload: e.payload });
      }
    }
    await logActivity(db, context.data.session.name, 'sync_comments', mediaId ? 'media' : null, mediaId, `${synced}건`);
  }

  const where = ['c.is_mine = 0'];
  const binds = [];
  if (mediaId) { where.push('c.media_id = ?'); binds.push(mediaId); }
  if (status !== 'all') { where.push('c.status = ?'); binds.push(status); }

  const rows = await db.prepare(`
    SELECT c.*, m.caption AS media_caption, m.thumbnail_url AS media_thumb, m.media_url AS media_url, m.permalink AS media_permalink,
           m.media_type AS media_type, m.dm_kit_id AS media_kit_id, k.name AS media_kit_name,
           (SELECT COUNT(*) FROM comments r WHERE r.parent_id = c.id AND r.is_mine = 1) AS my_reply_count,
           (SELECT text FROM comments r WHERE r.parent_id = c.id AND r.is_mine = 1 ORDER BY timestamp DESC LIMIT 1) AS my_last_reply
    FROM comments c
    LEFT JOIN media m ON m.id = c.media_id
    LEFT JOIN dm_kits k ON k.id = m.dm_kit_id
    WHERE ${where.join(' AND ')}
    ORDER BY c.timestamp DESC
    LIMIT ?
  `).bind(...binds, limit).all();

  return json({ ok: true, comments: rows.results, now: now() });
}

// PATCH /api/ig/comments { id, status }  → 처리 완료/되돌리기
export async function onRequestPatch(context) {
  const { env } = context;
  const { id, status } = await readJson(context.request);
  if (!id || !['open', 'done'].includes(status)) return error('id 와 status(open|done) 가 필요합니다.');
  await env.DB.prepare('UPDATE comments SET status = ?, handled_by = ? WHERE id = ?')
    .bind(status, status === 'done' ? context.data.session.name : null, String(id)).run();
  await logActivity(env.DB, context.data.session.name, status === 'done' ? 'comment_done' : 'comment_reopen', 'comment', String(id));
  return json({ ok: true });
}

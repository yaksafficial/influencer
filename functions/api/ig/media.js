// 게시물 목록 (D1 캐시) / 동기화 / 게시물별 기본 자료(킷) 설정
import { json, error, readJson, getAccount, refreshTokenIfNeeded, igFetch, toMs, now, logActivity, isRateLimited, RATE_LIMIT_MSG } from './_lib.js';

const FIELDS = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,comments_count,like_count';

// GET /api/ig/media            → D1 캐시 + 미처리 댓글 수
// GET /api/ig/media?sync=1     → Instagram API 에서 최신 100개 동기화 후 반환
export async function onRequestGet(context) {
  const { env } = context;
  const db = env.DB;
  const url = new URL(context.request.url);

  if (url.searchParams.get('sync') === '1') {
    let account = await getAccount(db);
    if (!account) return error('Instagram 계정이 연결되지 않았습니다.', 409);
    account = await refreshTokenIfNeeded(env, db, account);
    let synced = 0;
    try {
      let path = `/${account.ig_user_id}/media`;
      let params = { fields: FIELDS, limit: 50 };
      for (let page = 0; page < 2; page++) {
        const data = await igFetch(env, account, path, { params });
        for (const m of data.data || []) {
          await db.prepare(`
            INSERT INTO media (id, caption, media_type, media_url, thumbnail_url, permalink, timestamp, comments_count, like_count, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              caption = excluded.caption, media_type = excluded.media_type, media_url = excluded.media_url,
              thumbnail_url = excluded.thumbnail_url, permalink = excluded.permalink, timestamp = excluded.timestamp,
              comments_count = excluded.comments_count, like_count = excluded.like_count, synced_at = excluded.synced_at
          `).bind(String(m.id), m.caption || null, m.media_type || null, m.media_url || null, m.thumbnail_url || null,
            m.permalink || null, toMs(m.timestamp), m.comments_count || 0, m.like_count || 0, now()).run();
          synced++;
        }
        const next = data.paging && data.paging.cursors && data.paging.cursors.after;
        if (!next || !(data.data || []).length) break;
        params = { fields: FIELDS, limit: 50, after: next };
      }
    } catch (e) {
      if (isRateLimited(e)) return error(RATE_LIMIT_MSG, 429, { code: 'rate_limited' });
      return error(`게시물 동기화 실패: ${e.message}`, 502, { payload: e.payload });
    }
    await logActivity(db, context.data.session.name, 'sync_media', null, null, `${synced}건`);
  }

  const rows = await db.prepare(`
    SELECT m.*, k.name AS dm_kit_name,
      (SELECT COUNT(*) FROM comments c WHERE c.media_id = m.id AND c.is_mine = 0) AS total_comments,
      (SELECT COUNT(*) FROM comments c WHERE c.media_id = m.id AND c.is_mine = 0 AND c.status = 'open') AS open_comments,
      (SELECT COUNT(*) FROM comments c WHERE c.media_id = m.id AND c.is_mine = 0 AND c.private_reply_sent_at IS NULL AND c.timestamp > ?) AS sendable_comments,
      (SELECT MAX(timestamp) FROM comments c WHERE c.media_id = m.id AND c.is_mine = 0) AS last_comment_at
    FROM media m LEFT JOIN dm_kits k ON k.id = m.dm_kit_id
    ORDER BY COALESCE(m.timestamp, 0) DESC
  `).bind(now() - 7 * 86400000).all();

  return json({ ok: true, media: rows.results });
}

// PATCH /api/ig/media { id, dm_kit_id }  → 게시물 기본 자료 지정 (null 이면 해제)
export async function onRequestPatch(context) {
  const { env } = context;
  const { id, dm_kit_id } = await readJson(context.request);
  if (!id) return error('id 가 필요합니다.');
  await env.DB.prepare('UPDATE media SET dm_kit_id = ? WHERE id = ?').bind(dm_kit_id || null, String(id)).run();
  await logActivity(env.DB, context.data.session.name, 'set_media_kit', 'media', String(id), dm_kit_id ? `kit ${dm_kit_id}` : '해제');
  return json({ ok: true });
}

// 연결 상태 헬스체크: 토큰 만료, API 응답, DM 접근, 웹훅 최근 수신, 집계
import { json, getAccount, refreshTokenIfNeeded, igFetch, getSetting, now } from './_lib.js';

export async function onRequestGet(context) {
  const { env } = context;
  const db = env.DB;
  let account = await getAccount(db);

  const result = {
    ok: true,
    connected: !!account,
    account: null,
    checks: {},
    webhook: {
      last_event_at: Number(await getSetting(db, 'webhook_last_event_at')) || null,
      last_comment_at: Number(await getSetting(db, 'webhook_last_comment_at')) || null,
      last_message_at: Number(await getSetting(db, 'webhook_last_message_at')) || null,
      subscribe_error: JSON.parse((await getSetting(db, 'webhook_subscribe_error')) || 'null'),
      verify_token_set: !!env.IG_WEBHOOK_VERIFY_TOKEN,
    },
    env: {
      app_id_set: !!env.IG_APP_ID,
      login_url_set: !!env.IG_LOGIN_URL,
      app_secret_set: !!env.IG_APP_SECRET,
      admin_password_set: !!env.INBOX_ADMIN_PASSWORD,
    },
    counts: {},
    granted_permissions: JSON.parse((await getSetting(db, 'granted_permissions')) || '[]'),
    token_refresh_error: JSON.parse((await getSetting(db, 'token_refresh_error')) || 'null'),
    now: now(),
  };

  const c = await db.batch([
    db.prepare("SELECT COUNT(*) AS n FROM comments WHERE status = 'open' AND is_mine = 0"),
    db.prepare("SELECT COUNT(*) AS n FROM conversations WHERE status = 'open'"),
    db.prepare('SELECT COUNT(*) AS n FROM dm_kits'),
    db.prepare('SELECT COUNT(*) AS n FROM staff WHERE active = 1'),
    db.prepare("SELECT COUNT(*) AS n FROM comments WHERE status = 'open' AND is_mine = 0 AND private_reply_sent_at IS NULL AND timestamp > ?").bind(now() - 7 * 24 * 3600 * 1000),
  ]);
  result.counts = {
    open_comments: c[0].results[0].n,
    open_conversations: c[1].results[0].n,
    kits: c[2].results[0].n,
    staff: c[3].results[0].n,
    sendable_comments: c[4].results[0].n,
  };

  if (!account) return json(result);

  account = await refreshTokenIfNeeded(env, db, account);
  result.account = {
    ig_user_id: account.ig_user_id,
    username: account.username,
    connected_at: account.connected_at,
    refreshed_at: account.refreshed_at,
    token_expires_at: account.token_expires_at,
    token_days_left: account.token_expires_at ? Math.floor((account.token_expires_at - now()) / 86400000) : null,
    webhook_fields: account.webhook_fields,
    api_host: account.api_host || 'instagram',
  };

  // API 응답 확인
  try {
    const me = await igFetch(env, account, `/${account.ig_user_id}`, { params: { fields: 'id,username' } });
    result.checks.api = { ok: true, username: me.username };
  } catch (e) {
    result.checks.api = { ok: false, error: e.message, code: e.payload && e.payload.error && e.payload.error.code };
  }

  // DM 접근 확인 ("메시지 접근 허용" 토글이 꺼져 있으면 여기서 실패하거나 빈 결과)
  try {
    const conv = await igFetch(env, account, `/${account.ig_user_id}/conversations`, { params: { platform: 'instagram', limit: 1 } });
    result.checks.messaging = { ok: true, sample: Array.isArray(conv.data) ? conv.data.length : 0 };
  } catch (e) {
    result.checks.messaging = { ok: false, error: e.message, code: e.payload && e.payload.error && e.payload.error.code };
  }

  // 웹훅 구독 상태 확인
  try {
    const subs = await igFetch(env, account, `/${account.ig_user_id}/subscribed_apps`);
    result.checks.webhook_subscription = { ok: true, data: subs.data || subs };
  } catch (e) {
    result.checks.webhook_subscription = { ok: false, error: e.message };
  }

  return json(result);
}

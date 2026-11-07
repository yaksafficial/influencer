// 토큰 직접 연결 (owner 전용)
// Meta 앱 대시보드 "액세스 토큰 생성"에서 받은 토큰을 붙여넣어 계정을 연결한다.
// 신규 앱의 통합 로그인(Unified login) 토큰과 기존 Instagram 로그인 토큰 모두 지원.
import { json, error, readJson, detectToken, saveAccount, subscribeWebhooks, setSetting, logActivity, now } from './_lib.js';

// POST { access_token, ig_user_id? }
export async function onRequestPost(context) {
  const { env } = context;
  if (context.data.session.role !== 'owner') return error('계정 연결은 owner 만 가능합니다.', 403);
  const b = await readJson(context.request);
  const token = String(b.access_token || '').trim();
  const hint = String(b.ig_user_id || '').trim() || null;
  if (token.length < 20) return error('토큰을 붙여넣어 주세요.');
  if (hint && !/^\d+$/.test(hint)) return error('Instagram 계정 ID 는 숫자만 입력하세요.');

  let info;
  try {
    info = await detectToken(env, token, hint);
  } catch (e) {
    return error('토큰으로 계정을 확인하지 못했습니다. 토큰이 맞는지, 계정 ID 를 함께 입력해야 하는지 확인하세요.', 400, { tried: e.tried || [e.message] });
  }

  const account = { ...info, access_token: token };
  const sub = await subscribeWebhooks(env, account);
  await saveAccount(env.DB, { ...account, webhook_fields: sub.ok ? sub.fields : null });
  await setSetting(env.DB, 'webhook_subscribe_error', sub.ok ? null : JSON.stringify({ at: now(), message: sub.error, payload: sub.payload }));
  await logActivity(env.DB, 'owner', 'connect_instagram', 'account', info.ig_user_id, `${info.username || ''} (${info.api_host}, 토큰)`);

  return json({
    ok: true,
    ig_user_id: info.ig_user_id,
    username: info.username,
    api_host: info.api_host,
    token_expires_at: info.token_expires_at,
    webhook_subscribed: sub.ok,
    webhook_error: sub.ok ? undefined : sub.error,
  });
}

// DELETE → 연결 해제 (저장된 토큰 삭제)
export async function onRequestDelete(context) {
  const { env } = context;
  if (context.data.session.role !== 'owner') return error('연결 해제는 owner 만 가능합니다.', 403);
  await env.DB.prepare('DELETE FROM ig_account WHERE id = 1').run();
  await logActivity(env.DB, 'owner', 'disconnect_instagram', 'account', null);
  return json({ ok: true });
}

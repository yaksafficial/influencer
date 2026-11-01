// Instagram Business Login 콜백: code → 단기 토큰 → 장기 토큰 → 계정 저장 → 웹훅 구독
import { getSetting, setSetting, saveAccount, igFetch, apiBase, siteOrigin, logActivity, now } from './_lib.js';

const WEBHOOK_FIELDS = 'comments,messages';

function back(request, params) {
  const url = new URL('/inbox.html', siteOrigin(request));
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return Response.redirect(url.toString(), 302);
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const denied = url.searchParams.get('error');

  if (denied) return back(request, { connect_error: url.searchParams.get('error_description') || denied });
  if (!code) return back(request, { connect_error: 'code 가 없습니다.' });

  // state 검증 (10분 이내, 일치)
  const saved = JSON.parse((await getSetting(env.DB, 'oauth_state')) || 'null');
  if (!saved || saved.state !== state || now() - saved.at > 10 * 60 * 1000) {
    return back(request, { connect_error: '인증 세션이 만료되었거나 일치하지 않습니다. 다시 시도하세요.' });
  }
  await setSetting(env.DB, 'oauth_state', null);

  if (!env.IG_APP_ID || !env.IG_APP_SECRET) {
    return back(request, { connect_error: 'IG_APP_ID / IG_APP_SECRET 환경변수가 없습니다.' });
  }

  try {
    // 1) code → 단기 토큰
    const form = new URLSearchParams();
    form.set('client_id', env.IG_APP_ID);
    form.set('client_secret', env.IG_APP_SECRET);
    form.set('grant_type', 'authorization_code');
    form.set('redirect_uri', `${siteOrigin(request)}/api/ig/callback`);
    // Instagram 은 code 끝에 '#_' 를 붙여 보내는 경우가 있음
    form.set('code', code.replace(/#_$/, ''));

    const shortRes = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const shortData = await shortRes.json().catch(() => ({}));
    if (!shortRes.ok || !shortData.access_token) {
      throw new Error(`단기 토큰 교환 실패: ${JSON.stringify(shortData).slice(0, 300)}`);
    }

    // 2) 단기 → 장기 토큰 (60일)
    const longUrl = new URL(`${apiBase(env)}/access_token`);
    longUrl.searchParams.set('grant_type', 'ig_exchange_token');
    longUrl.searchParams.set('client_secret', env.IG_APP_SECRET);
    longUrl.searchParams.set('access_token', shortData.access_token);
    const longRes = await fetch(longUrl.toString());
    const longData = await longRes.json().catch(() => ({}));
    if (!longRes.ok || !longData.access_token) {
      throw new Error(`장기 토큰 교환 실패: ${JSON.stringify(longData).slice(0, 300)}`);
    }
    const token = longData.access_token;
    const expiresAt = now() + (longData.expires_in || 60 * 60 * 24 * 60) * 1000;

    // 3) 프로필 (user_id = Instagram 프로페셔널 계정 ID)
    const me = await igFetch(env, token, '/me', { params: { fields: 'user_id,username,name' } });
    const igUserId = String(me.user_id || shortData.user_id);

    // 4) 웹훅 구독 (Instagram 로그인 방식은 계정별 구독 호출이 필요)
    let webhookFields = null;
    try {
      await igFetch(env, token, `/${igUserId}/subscribed_apps`, {
        method: 'POST',
        params: { subscribed_fields: WEBHOOK_FIELDS },
      });
      webhookFields = WEBHOOK_FIELDS;
    } catch (e) {
      await setSetting(env.DB, 'webhook_subscribe_error', JSON.stringify({ at: now(), message: e.message, payload: e.payload }));
    }

    await saveAccount(env.DB, {
      ig_user_id: igUserId,
      username: me.username || null,
      access_token: token,
      token_expires_at: expiresAt,
      webhook_fields: webhookFields,
    });
    await setSetting(env.DB, 'granted_permissions', JSON.stringify(shortData.permissions || []));
    await logActivity(env.DB, 'owner', 'connect_instagram', 'account', igUserId, me.username);

    return back(request, { connected: '1' });
  } catch (e) {
    return back(request, { connect_error: e.message || String(e) });
  }
}

// Instagram Business Login 시작 (owner 전용). 브라우저를 Instagram 인증 화면으로 보낸다.
import { error, randomToken, setSetting, siteOrigin, IG_SCOPES, now } from './_lib.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  if (context.data.session.role !== 'owner') return error('계정 연결은 owner 만 가능합니다.', 403);
  if (!env.IG_APP_ID) return error('IG_APP_ID 환경변수가 설정되지 않았습니다.', 500);

  const state = randomToken(16);
  await setSetting(env.DB, 'oauth_state', JSON.stringify({ state, at: now() }));

  const redirectUri = `${siteOrigin(request)}/api/ig/callback`;
  const url = new URL('https://www.instagram.com/oauth/authorize');
  url.searchParams.set('enable_fb_login', '0');
  url.searchParams.set('force_authentication', '1');
  url.searchParams.set('client_id', env.IG_APP_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', IG_SCOPES.join(','));
  url.searchParams.set('state', state);

  return Response.redirect(url.toString(), 302);
}

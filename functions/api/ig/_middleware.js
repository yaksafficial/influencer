// /api/ig/* 전체에 적용되는 세션 검사.
// 공개 경로(웹훅, OAuth 콜백, 로그인)는 통과시키고, 나머지는 로그인 필수.
import { getSession, error } from './_lib.js';

const PUBLIC_PATHS = new Set([
  '/api/ig/webhook',
  '/api/ig/callback',
  '/api/ig/auth/login',
  '/api/ig/sso',
]);

export async function onRequest(context) {
  const { pathname } = new URL(context.request.url);

  if (!context.env.DB) {
    return error('D1 바인딩(DB)이 설정되지 않았습니다. wrangler.toml 의 d1_databases 를 확인하세요.', 500);
  }

  if (PUBLIC_PATHS.has(pathname)) {
    return context.next();
  }

  const session = await getSession(context);
  if (!session) {
    return error('로그인이 필요합니다.', 401, { code: 'unauthenticated' });
  }
  context.data.session = session;
  try {
    return await context.next();
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (/limit|exceeded|too many/i.test(msg) && /d1|sql|query|rows/i.test(msg)) {
      return error('오늘 Cloudflare 무료 사용량 한도에 도달했습니다. 매일 오전 9시(한국 시간)에 다시 풀립니다.', 503, { code: 'd1_limit', detail: msg.slice(0, 200) });
    }
    return error(`서버 오류: ${msg.slice(0, 200)}`, 500);
  }
}

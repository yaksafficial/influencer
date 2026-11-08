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
  return context.next();
}

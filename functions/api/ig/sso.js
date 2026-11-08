// 근무앱(yaksa-work-app) → 약사피셜 CS 자동 로그인 (공개 경로)
// GET /api/ig/sso?u=<이름>&ts=<unix초>&sig=<hex>
//   sig = HMAC-SHA256(CS_SSO_SECRET, `${u}.${ts}`) 의 hex
// 근무앱과 이 서버가 같은 비밀값(CS_SSO_SECRET)을 갖고 있을 때만 통과한다.
import { createSession, sessionCookie, logActivity, toHex, siteOrigin, now } from './_lib.js';

const MAX_SKEW_SEC = 600; // 서명 유효 10분 (근무앱이 같은 주소를 잠시 재사용)

// 근무앱 이름 → CS 권한. 환경변수 CS_SSO_USERS("이름:역할,이름:역할")로 바꿀 수 있다.
const DEFAULT_USERS = { 명훈약사: 'owner', 지우약사: 'staff' };

function userMap(env) {
  if (!env.CS_SSO_USERS) return DEFAULT_USERS;
  const out = {};
  String(env.CS_SSO_USERS).split(',').forEach((pair) => {
    const [name, role] = pair.split(':').map((x) => (x || '').trim());
    if (name && (role === 'owner' || role === 'staff')) out[name] = role;
  });
  return out;
}

async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function toInbox(request, params = {}, headers = {}) {
  const url = new URL('/inbox.html', siteOrigin(request));
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new Response(null, { status: 302, headers: { Location: url.toString(), 'Cache-Control': 'no-store', ...headers } });
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const name = (url.searchParams.get('u') || '').trim();
  const ts = Number(url.searchParams.get('ts'));
  const sig = (url.searchParams.get('sig') || '').toLowerCase();

  if (!env.CS_SSO_SECRET) return toInbox(request, { sso_error: '자동 로그인이 설정되지 않았습니다 (CS_SSO_SECRET).' });
  if (!name || !ts || !/^[0-9a-f]{64}$/.test(sig)) return toInbox(request, { sso_error: '자동 로그인 정보가 올바르지 않습니다.' });
  if (Math.abs(Math.floor(now() / 1000) - ts) > MAX_SKEW_SEC) return toInbox(request, { sso_error: '자동 로그인 시간이 만료되었습니다. 근무앱에서 메뉴를 다시 눌러 주세요.' });

  const expected = await hmacHex(env.CS_SSO_SECRET, `${name}.${ts}`);
  if (!safeEqual(expected, sig)) return toInbox(request, { sso_error: '자동 로그인 서명이 맞지 않습니다. 근무앱과 CS의 비밀값이 같은지 확인하세요.' });

  const role = userMap(env)[name];
  if (!role) return toInbox(request, { sso_error: `${name} 님은 인스타 CS 사용 권한이 없습니다.` });

  // 직원 계정이 CS 설정에서 '비활성화'되어 있으면 거부
  if (role === 'staff') {
    const row = await env.DB.prepare('SELECT active FROM staff WHERE name = ?').bind(name).first();
    if (row && !row.active) return toInbox(request, { sso_error: '비활성화된 직원 계정입니다.' });
  }

  const { token, maxAgeSec } = await createSession(env.DB, name, role);
  await logActivity(env.DB, name, 'login_sso', null, null, '근무앱');
  return toInbox(request, {}, { 'Set-Cookie': sessionCookie(token, maxAgeSec) });
}

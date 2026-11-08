// 고객 응대 인박스 공용 라이브러리
// onRequest* export 가 없으므로 Pages Functions 라우트로 노출되지 않는다.

export const SESSION_COOKIE = 'inbox_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14일

export function now() {
  return Date.now();
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

export function error(message, status = 400, extra = {}) {
  return json({ ok: false, error: message, ...extra }, status);
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch (_) {
    return {};
  }
}

// ── 바이너리/인코딩 유틸 ─────────────────────────────────────

export function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return toHex(arr.buffer);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── 비밀번호 (PBKDF2-SHA256) ─────────────────────────────────

export async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 20000 }, // Workers 무료 플랜 CPU 10ms 한도 내 (약 4ms)
    key,
    256
  );
  return toHex(bits);
}

export async function verifyPassword(password, salt, expectedHash) {
  const h = await hashPassword(password, salt);
  return timingSafeEqual(h, expectedHash);
}

// ── 웹훅 서명 검증 (X-Hub-Signature-256) ──────────────────────

export async function verifyHubSignature(rawBody, signatureHeader, appSecret) {
  if (!signatureHeader || !appSecret) return false;
  const [algo, sig] = signatureHeader.split('=');
  if (algo !== 'sha256' || !sig) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  return timingSafeEqual(toHex(mac), sig.toLowerCase());
}

// ── 쿠키 / 세션 ──────────────────────────────────────────────

export function parseCookies(request) {
  const out = {};
  const header = request.headers.get('cookie') || '';
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

export function sessionCookie(token, maxAgeSec) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

export async function createSession(db, staffName, role) {
  const token = randomToken();
  const expires = now() + SESSION_TTL_MS;
  await db.prepare('INSERT INTO sessions (token, staff_name, role, expires_at) VALUES (?, ?, ?, ?)')
    .bind(token, staffName, role, expires).run();
  // 만료 세션 정리 (가끔)
  if (Math.random() < 0.1) {
    await db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now()).run();
  }
  return { token, maxAgeSec: Math.floor(SESSION_TTL_MS / 1000) };
}

export async function getSession(context) {
  const token = parseCookies(context.request)[SESSION_COOKIE];
  if (!token || !context.env.DB) return null;
  const row = await context.env.DB.prepare('SELECT staff_name, role, expires_at FROM sessions WHERE token = ?')
    .bind(token).first();
  if (!row || row.expires_at < now()) return null;
  return { name: row.staff_name, role: row.role, token };
}

export async function destroySession(db, token) {
  if (token) await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
}

// ── 활동 로그 ────────────────────────────────────────────────

export async function logActivity(db, staffName, action, targetType = null, targetId = null, detail = null) {
  try {
    await db.prepare(
      'INSERT INTO activity_log (staff_name, action, target_type, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(staffName, action, targetType, targetId, detail ? String(detail).slice(0, 500) : null, now()).run();
  } catch (_) {
    // 로그 실패가 본 작업을 막지 않도록
  }
}

// ── 설정 키/값 ───────────────────────────────────────────────

export async function getSetting(db, key) {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row ? row.value : null;
}

export async function setSetting(db, key, value) {
  await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, value == null ? null : String(value)).run();
}

// ── Instagram Graph API 클라이언트 ────────────────────────────

export const IG_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_comments',
  'instagram_business_manage_messages',
];

// api_host: 'instagram' → graph.instagram.com (Instagram 로그인 토큰, IGAA…)
//           'facebook'  → graph.facebook.com  (통합 로그인/시스템 사용자 토큰, EAA…)
export function apiBase(env, host = 'instagram') {
  const v = env.IG_API_VERSION || 'v23.0';
  return host === 'facebook' ? `https://graph.facebook.com/${v}` : `https://graph.instagram.com/${v}`;
}

export function guessHost(token) {
  return /^IG/.test(String(token || '')) ? 'instagram' : 'facebook';
}

export async function getAccount(db) {
  return db.prepare('SELECT * FROM ig_account WHERE id = 1').first();
}

export async function saveAccount(db, { ig_user_id, username, access_token, token_expires_at, webhook_fields, api_host }) {
  await db.prepare(`
    INSERT INTO ig_account (id, ig_user_id, username, access_token, token_expires_at, connected_at, refreshed_at, webhook_fields, api_host)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      ig_user_id = excluded.ig_user_id,
      username = excluded.username,
      access_token = excluded.access_token,
      token_expires_at = excluded.token_expires_at,
      connected_at = excluded.connected_at,
      refreshed_at = excluded.refreshed_at,
      webhook_fields = excluded.webhook_fields,
      api_host = excluded.api_host
  `).bind(ig_user_id, username || null, access_token, token_expires_at || null, now(), now(), webhook_fields || null, api_host || 'instagram').run();
}

export class IgApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

// auth: 계정 행({ access_token, api_host }) 또는 토큰 문자열(instagram 호스트)
// path: '/123/media' 처럼 슬래시로 시작. params 는 쿼리, body 는 JSON 바디(POST)
export async function igFetch(env, auth, path, { method = 'GET', params = {}, body = null } = {}) {
  const token = typeof auth === 'string' ? auth : auth.access_token;
  const host = typeof auth === 'string' ? 'instagram' : auth.api_host || 'instagram';
  const url = new URL(`${apiBase(env, host)}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  });
  url.searchParams.set('access_token', token);

  const init = { method, headers: {} };
  if (body) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), init);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    data = { raw: text };
  }
  if (!res.ok || data.error) {
    const e = data.error || {};
    const msg = e.message || e.error_user_msg || `Instagram API ${res.status}`;
    throw new IgApiError(msg, res.status, data);
  }
  return data;
}

// 토큰이 10일 이내 만료면 갱신 (long-lived 토큰은 발급 24시간 후부터 갱신 가능)
export async function refreshTokenIfNeeded(env, db, account) {
  if (!account) return account;
  if (account.api_host === 'facebook') return account; // 시스템 사용자 토큰은 만료 없음
  const TEN_DAYS = 1000 * 60 * 60 * 24 * 10;
  const ONE_DAY = 1000 * 60 * 60 * 24;
  const expiresSoon = !account.token_expires_at || account.token_expires_at - now() < TEN_DAYS;
  const oldEnough = !account.refreshed_at || now() - account.refreshed_at > ONE_DAY;
  if (!expiresSoon || !oldEnough) return account;

  const url = new URL(`${apiBase(env)}/refresh_access_token`);
  url.searchParams.set('grant_type', 'ig_refresh_token');
  url.searchParams.set('access_token', account.access_token);
  const res = await fetch(url.toString());
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    await setSetting(db, 'token_refresh_error', JSON.stringify({ at: now(), data }));
    return account;
  }
  const expiresAt = now() + (data.expires_in || 60 * 60 * 24 * 60) * 1000;
  await db.prepare('UPDATE ig_account SET access_token = ?, token_expires_at = ?, refreshed_at = ? WHERE id = 1')
    .bind(data.access_token, expiresAt, now()).run();
  await setSetting(db, 'token_refresh_error', null);
  return { ...account, access_token: data.access_token, token_expires_at: expiresAt, refreshed_at: now() };
}

// 날짜 문자열(ISO 또는 +0000 형식) → epoch ms
export function toMs(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
  const s = String(value).replace(/\+0000$/, 'Z');
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

export function siteOrigin(request) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

// 상대 프로필(이름/팔로우 여부) 조회 — 응답 지연을 피하려고 백그라운드로 실행
export async function fetchProfile(env, account, participantId) {
  if (!account) return;
  try {
    const p = await igFetch(env, account, `/${participantId}`, {
      params: { fields: 'name,username,profile_pic,is_user_follow_business' },
    });
    await env.DB.prepare(`
      UPDATE conversations SET participant_username = ?, profile_pic = ?, is_follower = ? WHERE participant_id = ?
    `).bind(p.username || p.name || null, p.profile_pic || null,
      typeof p.is_user_follow_business === 'boolean' ? (p.is_user_follow_business ? 1 : 0) : null,
      participantId).run();
  } catch (_) {
    // 프로필 조회 실패는 무시 (상대가 계정을 비공개로 했거나 권한 문제)
  }
}

// 붙여넣은 토큰으로 연결 정보 파악: 호스트, Instagram 계정 ID, 사용자명, 만료
// ig_user_id 를 주면 그 계정으로 확정, 없으면 토큰 정보에서 찾는다.
export async function detectToken(env, token, igUserIdHint) {
  const tried = [];
  const order = guessHost(token) === 'instagram' ? ['instagram', 'facebook'] : ['facebook', 'instagram'];
  for (const host of order) {
    const auth = { access_token: token, api_host: host };
    try {
      if (host === 'instagram') {
        const me = await igFetch(env, auth, '/me', { params: { fields: 'user_id,username' } });
        const id = String(igUserIdHint || me.user_id || me.id);
        return { api_host: host, ig_user_id: id, username: me.username || null, token_expires_at: now() + 60 * 86400000 };
      }
      // facebook: debug_token 으로 권한 대상(Instagram 계정 ID)과 만료 확인
      let ids = [];
      let expiresAt = null;
      try {
        const dbg = await igFetch(env, auth, '/debug_token', { params: { input_token: token } });
        const d = dbg.data || {};
        (d.granular_scopes || []).forEach((g) => {
          if (/^instagram_/.test(g.scope)) (g.target_ids || []).forEach((t) => ids.push(String(t)));
        });
        if (d.expires_at && d.expires_at > 0) expiresAt = d.expires_at * 1000;
      } catch (e) {
        tried.push(`debug_token: ${e.message}`);
      }
      if (igUserIdHint) ids = [String(igUserIdHint)];
      ids = [...new Set(ids)];
      if (!ids.length) {
        // 페이지 연결형 토큰인 경우
        try {
          const pages = await igFetch(env, auth, '/me/accounts', { params: { fields: 'instagram_business_account{id,username}' } });
          (pages.data || []).forEach((p) => p.instagram_business_account && ids.push(String(p.instagram_business_account.id)));
        } catch (e) {
          tried.push(`me/accounts: ${e.message}`);
        }
      }
      for (const id of ids) {
        try {
          const ig = await igFetch(env, auth, `/${id}`, { params: { fields: 'id,username' } });
          if (ig.username) return { api_host: host, ig_user_id: String(ig.id || id), username: ig.username, token_expires_at: expiresAt };
        } catch (e) {
          tried.push(`${id}: ${e.message}`);
        }
      }
      if (!ids.length) tried.push('facebook: 토큰에서 Instagram 계정 ID를 찾지 못했습니다.');
    } catch (e) {
      tried.push(`${host}: ${e.message}`);
    }
  }
  const err = new Error('토큰을 확인하지 못했습니다.');
  err.tried = tried;
  throw err;
}

// 웹훅 구독 시도 (호스트별로 엔드포인트가 다를 수 있어 실패는 기록만)
export async function subscribeWebhooks(env, account, fields = 'comments,messages') {
  try {
    await igFetch(env, account, `/${account.ig_user_id}/subscribed_apps`, { method: 'POST', params: { subscribed_fields: fields } });
    return { ok: true, fields };
  } catch (e) {
    return { ok: false, error: e.message, payload: e.payload };
  }
}

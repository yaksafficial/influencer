import { json, error, readJson, verifyPassword, createSession, sessionCookie, logActivity } from '../_lib.js';

// POST { name, password }
// - name === 'owner' : 환경변수 INBOX_ADMIN_PASSWORD 와 비교 (약사 본인)
// - 그 외          : staff 테이블 (직원)
export async function onRequestPost(context) {
  const { env } = context;
  const { name, password } = await readJson(context.request);
  const cleanName = String(name || '').trim();
  const pw = String(password || '');
  if (!cleanName || !pw) return error('이름과 비밀번호를 입력하세요.');

  let role = null;
  if (cleanName.toLowerCase() === 'owner') {
    if (!env.INBOX_ADMIN_PASSWORD) return error('INBOX_ADMIN_PASSWORD 환경변수가 설정되지 않았습니다.', 500);
    if (pw !== env.INBOX_ADMIN_PASSWORD) return error('비밀번호가 올바르지 않습니다.', 401);
    role = 'owner';
  } else {
    const staff = await env.DB.prepare('SELECT name, password_hash, salt, active FROM staff WHERE name = ?')
      .bind(cleanName).first();
    if (!staff || !staff.active) return error('등록되지 않았거나 비활성화된 계정입니다.', 401);
    const ok = await verifyPassword(pw, staff.salt, staff.password_hash);
    if (!ok) return error('비밀번호가 올바르지 않습니다.', 401);
    role = 'staff';
  }

  const displayName = role === 'owner' ? 'owner' : cleanName;
  const { token, maxAgeSec } = await createSession(env.DB, displayName, role);
  await logActivity(env.DB, displayName, 'login');
  return json({ ok: true, name: displayName, role }, 200, { 'Set-Cookie': sessionCookie(token, maxAgeSec) });
}

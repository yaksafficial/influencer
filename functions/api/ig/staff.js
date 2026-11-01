// 직원 계정 관리 (owner 전용)
import { json, error, readJson, hashPassword, randomToken, now, logActivity } from './_lib.js';

function ownerOnly(context) {
  return context.data.session.role === 'owner' ? null : error('직원 관리는 owner 만 가능합니다.', 403);
}

export async function onRequestGet(context) {
  const rows = await context.env.DB.prepare('SELECT id, name, active, created_at FROM staff ORDER BY id').all();
  return json({ ok: true, staff: rows.results });
}

// POST { name, password }  → 생성 (이미 있으면 비밀번호 재설정)
export async function onRequestPost(context) {
  const deny = ownerOnly(context);
  if (deny) return deny;
  const { env } = context;
  const b = await readJson(context.request);
  const name = String(b.name || '').trim();
  const pw = String(b.password || '');
  if (!name || name.toLowerCase() === 'owner') return error('사용할 수 없는 이름입니다.');
  if (pw.length < 6) return error('비밀번호는 6자 이상이어야 합니다.');
  const salt = randomToken(16);
  const hash = await hashPassword(pw, salt);
  await env.DB.prepare(`
    INSERT INTO staff (name, password_hash, salt, active, created_at) VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(name) DO UPDATE SET password_hash = excluded.password_hash, salt = excluded.salt, active = 1
  `).bind(name, hash, salt, now()).run();
  await logActivity(env.DB, context.data.session.name, 'staff_upsert', 'staff', name);
  return json({ ok: true });
}

// PATCH { name, active }  → 활성/비활성
export async function onRequestPatch(context) {
  const deny = ownerOnly(context);
  if (deny) return deny;
  const { env } = context;
  const { name, active } = await readJson(context.request);
  if (!name) return error('name 이 필요합니다.');
  await env.DB.prepare('UPDATE staff SET active = ? WHERE name = ?').bind(active ? 1 : 0, String(name)).run();
  if (!active) await env.DB.prepare("DELETE FROM sessions WHERE staff_name = ? AND role = 'staff'").bind(String(name)).run();
  await logActivity(env.DB, context.data.session.name, active ? 'staff_enable' : 'staff_disable', 'staff', String(name));
  return json({ ok: true });
}

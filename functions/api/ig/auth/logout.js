import { json, destroySession, sessionCookie } from '../_lib.js';

export async function onRequestPost(context) {
  const session = context.data.session;
  await destroySession(context.env.DB, session && session.token);
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
}

import { json } from '../_lib.js';

export async function onRequestGet(context) {
  const { name, role } = context.data.session;
  return json({ ok: true, name, role });
}

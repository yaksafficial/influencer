// 과거 응대 검색: 댓글·DM 에서 키워드로 '고객 질문 → 우리 답변'을 찾는다.
// GET /api/ig/search?q=유산균 임산부&scope=all|comments|dm
//   - 띄어쓰기로 나눈 단어가 모두 들어간 글(AND)을 찾는다. 부분 일치(LIKE).
//   - 댓글: 일치한 글이 속한 댓글 묶음(원 댓글 + 답글 전체)을 돌려준다.
//   - DM: 일치한 메시지 앞뒤 대화(앞 2개, 뒤 3개)를 돌려준다.
import { json, error } from './_lib.js';

const MAX_TERMS = 4;
const MAX_HITS = 60;      // 단어가 들어간 글 최대 개수 (범위별)
const MAX_GROUPS = 30;    // 화면에 보여줄 묶음 최대 개수 (범위별)

function likeTerms(q) {
  return String(q || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_TERMS)
    .map((t) => `%${t.replace(/[\\%_]/g, (c) => '\\' + c)}%`);
}

function whereText(col, terms) {
  return terms.map(() => `${col} LIKE ? ESCAPE '\\'`).join(' AND ');
}

async function searchComments(db, terms) {
  const hits = await db.prepare(`
    SELECT id, parent_id, is_mine FROM comments
    WHERE ${whereText('text', terms)}
    ORDER BY timestamp DESC LIMIT ${MAX_HITS}
  `).bind(...terms).all();

  // 일치한 글 → 묶음의 원 댓글 ID
  const roots = [];
  const seen = new Set();
  for (const h of hits.results) {
    const root = h.parent_id || h.id;
    if (!seen.has(root)) { seen.add(root); roots.push(root); }
    if (roots.length >= MAX_GROUPS) break;
  }
  if (!roots.length) return [];

  const marks = roots.map(() => '?').join(',');
  const rows = await db.prepare(`
    SELECT c.id, c.parent_id, c.media_id, c.from_username, c.text, c.timestamp, c.is_mine, c.handled_by,
           m.caption AS media_caption, m.permalink AS media_permalink
    FROM comments c LEFT JOIN media m ON m.id = c.media_id
    WHERE c.id IN (${marks}) OR c.parent_id IN (${marks})
    ORDER BY c.timestamp ASC
  `).bind(...roots, ...roots).all();

  const groups = new Map(roots.map((r) => [r, { root: null, replies: [] }]));
  for (const r of rows.results) {
    if (groups.has(r.id)) groups.get(r.id).root = r;
    else if (r.parent_id && groups.has(r.parent_id)) groups.get(r.parent_id).replies.push(r);
  }
  return roots
    .map((id) => groups.get(id))
    .filter((g) => g.root)
    .map((g) => ({
      type: 'comment',
      at: Math.max(g.root.timestamp, ...g.replies.map((x) => x.timestamp)),
      media_caption: g.root.media_caption,
      media_permalink: g.root.media_permalink,
      question: g.root,
      replies: g.replies,
      answered: g.replies.some((x) => x.is_mine),
    }));
}

async function searchDms(db, terms) {
  const hits = await db.prepare(`
    SELECT id, participant_id, timestamp FROM messages
    WHERE ${whereText('text', terms)}
    ORDER BY timestamp DESC LIMIT ${MAX_HITS}
  `).bind(...terms).all();
  if (!hits.results.length) return [];

  // 대화별로 메시지를 한 번만 읽어 앞뒤 맥락을 자른다
  const byConv = new Map();
  for (const h of hits.results) {
    if (!byConv.has(h.participant_id)) byConv.set(h.participant_id, []);
    byConv.get(h.participant_id).push(h.id);
  }
  const groups = [];
  for (const [pid, ids] of byConv) {
    const conv = await db.prepare('SELECT participant_username FROM conversations WHERE participant_id = ?').bind(pid).first();
    const msgs = (await db.prepare(`
      SELECT id, direction, text, attachments, timestamp, sent_by FROM messages
      WHERE participant_id = ? ORDER BY timestamp ASC
    `).bind(pid).all()).results;
    // 같은 대화 안에서 겹치는 구간은 하나로 합친다
    const ranges = ids
      .map((id) => msgs.findIndex((m) => m.id === id))
      .filter((i) => i >= 0)
      .map((i) => [Math.max(0, i - 2), Math.min(msgs.length - 1, i + 3)])
      .sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
      else merged.push([...r]);
    }
    for (const [s, e] of merged) {
      const slice = msgs.slice(s, e + 1);
      groups.push({
        type: 'dm',
        at: Math.max(...slice.map((m) => m.timestamp)),
        participant_id: pid,
        username: conv ? conv.participant_username : null,
        messages: slice,
        match_ids: slice.filter((m) => ids.includes(m.id)).map((m) => m.id),
        answered: slice.some((m) => m.direction === 'out'),
      });
    }
    if (groups.length >= MAX_GROUPS) break;
  }
  return groups.slice(0, MAX_GROUPS);
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const terms = likeTerms(url.searchParams.get('q'));
  if (!terms.length) return error('검색어를 입력하세요.');
  const scope = url.searchParams.get('scope') || 'all';
  const db = context.env.DB;

  const comments = scope === 'dm' ? [] : await searchComments(db, terms);
  const dms = scope === 'comments' ? [] : await searchDms(db, terms);
  const results = [...comments, ...dms].sort((a, b) => b.at - a.at);

  return json({
    ok: true,
    q: url.searchParams.get('q'),
    counts: { comments: comments.length, dms: dms.length },
    results,
  });
}

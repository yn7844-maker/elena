import { createHmac, timingSafeEqual, createHash } from 'node:crypto';

export function equal(a, b) {
  return timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());
}
export function sign(value, secret) { return createHmac('sha256', secret).update(value).digest('hex'); }
export function session(secret, now = Date.now()) {
  const expiry = String(now + 7 * 86400000);
  return `${expiry}.${sign(expiry, secret)}`;
}
export function validSession(token, secret, now = Date.now()) {
  if (!secret || !token) return false;
  const [expiry, signature, extra] = token.split('.');
  return !extra && /^\d+$/.test(expiry) && Number(expiry) > now && Number(expiry) <= now + 7 * 86400000 && equal(signature, sign(expiry, secret));
}
export function cleanText(text = '') {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(text).replace(/<[^>]*>/g, '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, code) => {
    if (code[0] !== '#') return entities[code.toLowerCase()] ?? all;
    const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  }).trim();
}
export function safeUrl(value) {
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; } catch { return null; }
}
export function koreaDate(value = Date.now()) { return new Date(Number(value) + 9 * 3600000).toISOString().slice(0, 10); }
const stop = new Set('기자 뉴스 오늘 이번 지난 관련 통해 대한 위해 함께 있는 없는 있다 된다 하는 한다 밝혔 밝혔다 올해 내년 정부 사진 단독 속보 종합 공개 발표 추진 한국 국내 서울 네이버'.split(' '));
export function words(title) {
  return [...new Set((title.match(/[가-힣]{2,12}|[A-Za-z]{2,15}/g) ?? []).filter(x => !stop.has(x)))];
}
export function keywords(rows, now = Date.now()) {
  const counts = new Map();
  for (const row of rows) for (const word of words(row.title)) counts.set(word, (counts.get(word) ?? 0) + 1);
  return [...counts].map(([word, count]) => ({ word, count })).sort((a,b) => b.count-a.count || a.word.localeCompare(b.word)).slice(0, 18);
}
export function rising(rows, now = Date.now()) {
  const recent = rows.filter(r => +new Date(r.published_at) > now - 86400000);
  const prior = rows.filter(r => +new Date(r.published_at) <= now - 86400000 && +new Date(r.published_at) > now - 8 * 86400000);
  if (!recent.length || !prior.length) return [];
  const a = new Map(), b = new Map();
  for (const r of recent) for (const w of words(r.title)) a.set(w, (a.get(w) ?? 0)+1);
  for (const r of prior) for (const w of words(r.title)) b.set(w, (b.get(w) ?? 0)+1);
  return [...a].filter(([,n])=>n>=3).map(([word,count])=>({word,count, previous:b.get(word)??0, change:(count/recent.length-(b.get(word)??0)/prior.length)*100})).filter(x=>x.change>0).sort((x,y)=>y.change-x.change).slice(0,8);
}

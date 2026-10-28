import {query,setup} from '../lib/db.mjs';
import {equal,session,validSession,sign,keywords,rising} from '../lib/core.mjs';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  const send=(status,data)=>res.status(status).json(data);
  const secret=process.env.SESSION_SECRET, password=process.env.ARCHIVE_PASSWORD;
  if (!secret || secret.length<32 || !password || password.length<20) return send(503,{error:'Vercel에 ARCHIVE_PASSWORD(20자 이상), SESSION_SECRET(32자 이상)을 설정하세요.'});
  const route=new URL(req.url,'https://local').searchParams.get('route') || 'dashboard';
  if (!['GET','POST','PATCH'].includes(req.method)) return send(405,{error:'허용되지 않은 요청'});
  if (req.method!=='GET') {
    let origin;
    try { origin=new URL(req.headers.origin).host; } catch { return send(403,{error:'출처 확인 실패'}); }
    if (origin!==req.headers.host) return send(403,{error:'출처 확인 실패'});
  }
  const cookie = String(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('elena_session='))?.slice(14);
  const authenticated=validSession(cookie,secret);
  try {
    if (route==='logout' && req.method==='POST') {
      res.setHeader('Set-Cookie','elena_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
      return send(200,{ok:true});
    }
    if (route==='login' && req.method==='POST') {
      await setup();
      const bucket=sign(`${String(req.headers['x-vercel-forwarded-for']||'local').split(',')[0]}:${Math.floor(Date.now()/900000)}`,secret);
      const {rows:[limit]}=await query(`INSERT INTO login_limits(bucket,expires_at) VALUES($1,NOW()+INTERVAL '30 minutes')
        ON CONFLICT(bucket) DO UPDATE SET attempts=login_limits.attempts+1 RETURNING attempts`,[bucket]);
      await query('DELETE FROM login_limits WHERE expires_at < NOW()');
      if (limit.attempts>10) return send(429,{error:'로그인 시도가 많습니다. 15분 후 다시 시도하세요.'});
      if (typeof req.body?.password!=='string' || !equal(req.body.password,password)) return send(401,{error:'비밀번호를 확인하세요.'});
      res.setHeader('Set-Cookie',`elena_session=${session(secret)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`);
      return send(200,{ok:true});
    }
    if (!authenticated) return send(401,{error:'로그인이 필요합니다.'});
    await setup();
    if (route==='article' && req.method==='PATCH') {
      const {id,saved,note}=req.body||{};
      if (!/^\d+$/.test(String(id)) || (saved!==undefined && typeof saved!=='boolean') || (note!==undefined && (typeof note!=='string'||note.length>5000))) return send(400,{error:'저장할 값을 확인하세요. 메모는 5,000자까지 가능합니다.'});
      const {rowCount}=await query('UPDATE articles SET saved=COALESCE($2,saved),note=COALESCE($3,note) WHERE id=$1',[id,saved??null,note??null]);
      return rowCount?send(200,{ok:true}):send(404,{error:'기사를 찾을 수 없습니다.'});
    }
    if (route!=='dashboard'||req.method!=='GET') return send(404,{error:'없는 경로'});
    const url=new URL(req.url,'https://local');
    const requestedDays=Number(url.searchParams.get('days')||7);
    const days=[1,7,30,90].includes(requestedDays)?requestedDays:7;
    const topic=url.searchParams.get('topic')||'', search=(url.searchParams.get('search')||'').slice(0,100);
    const saved=url.searchParams.get('saved')==='1';
    const params=[Math.max(8,days),topic,search,saved];
    const {rows}=await query(`SELECT a.*, COALESCE((SELECT jsonb_agg(DISTINCT q.topic) FROM article_queries q WHERE q.article_id=a.id),'[]') AS topics,
      COALESCE((SELECT jsonb_agg(DISTINCT q.keyword) FROM article_queries q WHERE q.article_id=a.id),'[]') AS queries
      FROM articles a WHERE a.published_at>=NOW()-($1*INTERVAL '1 day') AND a.published_at<=NOW()
      AND ($2='' OR EXISTS(SELECT 1 FROM article_queries q WHERE q.article_id=a.id AND q.topic=$2))
      AND ($3='' OR strpos(lower(a.title||' '||a.description),lower($3))>0)
      AND (NOT $4 OR a.saved) ORDER BY a.published_at DESC LIMIT 5001`,params);
    const capped=rows.length>5000, sample=rows.slice(0,5000), now=Date.now();
    const selected=sample.filter(r=>+new Date(r.published_at)>=now-days*86400000);
    const [{rows:runs},{rows:batches},{rows:[coverage]}]=await Promise.all([
      query('SELECT * FROM collection_runs ORDER BY started_at DESC LIMIT 5'),
      query('SELECT * FROM trend_batches ORDER BY fetched_at DESC LIMIT 1'),
      query('SELECT MIN(first_seen) AS first_seen,COUNT(*)::int AS total FROM articles')
    ]);
    const enough=coverage.first_seen && +new Date(coverage.first_seen)<=now-8*86400000;
    return send(200,{
      articles:selected,keywords:keywords(selected),rising:enough&&!capped?rising(sample,now):[],
      risingReady:!!enough&&!capped, capped,runs,trends:batches[0]||null,coverage,
      topics:Object.fromEntries(['금융','경제','사회','문화','기타'].map(t=>[t,selected.filter(r=>r.topics.includes(t)).length])),
      scope:{days,topic,search,saved},generatedAt:new Date(now).toISOString()
    });
  } catch {
    return send(503,{error:'데이터베이스 연결을 확인하세요. Vercel의 DATABASE_URL과 Neon 연결 상태를 확인하면 됩니다.'});
  }
}

import {ARCHIVE_START} from '../lib/config.mjs';
import {query,setup} from '../lib/db.mjs';
import {keywords,rising} from '../lib/core.mjs';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  const send=(status,data)=>res.status(status).json(data);
  const route=new URL(req.url,'https://local').searchParams.get('route') || 'dashboard';
  if(req.method!=='GET'){
    res.setHeader('Allow','GET');
    return send(405,{error:'개인 메모와 즐겨찾기는 브라우저에 저장됩니다. 서버 수정 기능은 제공하지 않습니다.'});
  }
  if(route!=='dashboard')return send(404,{error:'없는 경로'});
  // 기존 세션 쿠키는 더 이상 사용하지 않습니다.
  if(String(req.headers.cookie||'').includes('elena_session='))
    res.setHeader('Set-Cookie','elena_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
  let stage='request';
  try {
    stage='database-setup';
    await setup();
    const url=new URL(req.url,'https://local');
    const requestedDays=Number(url.searchParams.get('days')??7);
    const days=[0,1,7,30,90].includes(requestedDays)?requestedDays:7;
    const topic=url.searchParams.get('topic')||'', search=(url.searchParams.get('search')||'').slice(0,100);
    const params=[days===0?0:Math.max(8,days),topic,search,ARCHIVE_START];
    stage='articles-query';
    const {rows}=await query(`SELECT a.id,a.url,a.naver_url,a.title,a.description,a.published_at, COALESCE((SELECT jsonb_agg(DISTINCT q.topic) FROM article_queries q WHERE q.article_id=a.id),'[]') AS topics,
      COALESCE((SELECT jsonb_agg(DISTINCT q.keyword) FROM article_queries q WHERE q.article_id=a.id),'[]') AS queries
      FROM articles a WHERE ($1::int=0 OR a.published_at>=NOW()-($1*INTERVAL '1 day')) AND a.published_at<=NOW() AND a.published_at >= $4::timestamptz
      AND ($2='' OR EXISTS(SELECT 1 FROM article_queries q WHERE q.article_id=a.id AND q.topic=$2))
      AND ($3='' OR strpos(lower(a.title||' '||a.description),lower($3))>0)
      ORDER BY a.published_at DESC LIMIT 5001`,params);
    const capped=rows.length>5000, sample=rows.slice(0,5000), now=Date.now();
    const selected=sample.filter(r=>days===0||+new Date(r.published_at)>=now-days*86400000);
    stage='metadata-query';
    const [{rows:runs},{rows:batches},{rows:[coverage]}]=await Promise.all([
      query('SELECT * FROM collection_runs ORDER BY started_at DESC LIMIT 5'),
      query('SELECT * FROM trend_batches ORDER BY fetched_at DESC LIMIT 1'),
      query('SELECT MIN(first_seen) AS first_seen,COUNT(*)::int AS total FROM articles WHERE published_at >= $1::timestamptz',[ARCHIVE_START])
    ]);
    stage='response-build';
    const enough=coverage.first_seen && +new Date(coverage.first_seen)<=now-8*86400000;
    return send(200,{
      articles:selected.map(({note,saved,...article})=>article),keywords:keywords(selected),rising:enough&&!capped?rising(sample,now):[],
      risingReady:!!enough&&!capped, capped,runs,trends:batches[0]||null,coverage,
      topics:Object.fromEntries(['금융','경제','사회','문화','AI','기타'].map(t=>[t,selected.filter(r=>r.topics.includes(t)).length])),
      scope:{days,topic,search},generatedAt:new Date(now).toISOString()
    });
  } catch (error) {
    // 공개 응답/로그에는 DB 주소, 사용자명, 비밀번호, SQL 내용, 원문 오류를 출력하지 않습니다.
    const rawCode=String(error?.code||'');
    const code=/^[A-Z0-9_]{2,40}$/.test(rawCode)?rawCode:'REQUEST_FAILED';
    const messages={
      DB_URL_MISSING:'Vercel의 DATABASE_URL이 설정되지 않았습니다. 현재 배포에 적용된 환경 변수를 확인하세요.',
      DB_URL_INVALID:'DATABASE_URL 형식을 확인하세요. postgresql://로 시작하는 연결 문자열만 따옴표 없이 입력하세요.',
      '28P01':'데이터베이스 인증에 실패했습니다. Neon의 현재 연결 문자열과 일치하는지 확인하세요.',
      '28000':'데이터베이스 인증 또는 접근 권한을 확인하세요.',
      '3D000':'연결 대상 데이터베이스를 찾을 수 없습니다. Neon의 데이터베이스 선택을 확인하세요.',
      '42501':'연결된 DB 계정에 필요한 테이블 생성 또는 조회 권한이 없습니다.',
      '42P01':'필요한 테이블을 찾을 수 없습니다. 수집 작업과 같은 데이터베이스인지 확인하세요.',
      ENOTFOUND:'데이터베이스 서버 주소를 찾을 수 없습니다. 연결 문자열의 호스트를 확인하세요.',
      ECONNREFUSED:'데이터베이스 서버가 연결을 거부했습니다.',
      ETIMEDOUT:'데이터베이스 연결 시간이 초과되었습니다. 잠시 후 다시 시도하세요.'
    };
    const message=messages[code]||(stage==='response-build'?'데이터를 표시하는 중 오류가 발생했습니다.':'기사 데이터를 불러오지 못했습니다.');
    console.error('archive_request_failed',{code,stage});
    return send(503,{error:message+' [오류 '+code+' / '+stage+']',code,stage});
  }
}

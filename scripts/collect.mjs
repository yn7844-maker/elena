import {query,setup,close} from '../lib/db.mjs';
import {topics,trendGroups,collectionCutoff,ARCHIVE_START} from '../lib/config.mjs';
import {naver} from '../lib/naver.mjs';
import {cleanText,safeUrl,koreaDate} from '../lib/core.mjs';

async function collect() {
await setup();
const {rows:[run]} = await query('INSERT INTO collection_runs DEFAULT VALUES RETURNING id');
const errors = []; const warnings = []; let fetched = 0;
const started = Date.now();
console.log('수집 시작: 검색어별 진행 상황을 아래에 표시합니다.');
try {
  const {rows:[last]} = await query("SELECT finished_at FROM collection_runs WHERE status IN ('success','partial') AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1");
  // 최초 실행은 10/26부터. 이후 48시간 겹쳐 조회하되 시작일 이전으로 내려가지 않습니다.
  const cutoff = collectionCutoff(last?.finished_at);
  console.log(`아카이브 시작: ${ARCHIVE_START} · 이번 조회 하한: ${new Date(cutoff).toISOString()}`);
  for (const [topic, queries] of Object.entries(topics)) for (const keyword of queries) {
    try {
      let reachedCutoff = false, capped = false;
      console.log(`[${topic}] ${keyword}: 조회 시작`);
      for (let start=1; start<=901; start+=100) {
        const data = await naver(`/search/v1/news?${new URLSearchParams({query:keyword,display:'100',start:String(start),sort:'date',format:'json'})}`, 'NEWS');
        if (!Array.isArray(data.items)) throw new Error('뉴스 응답 형식 오류');
        const batch = new Map();
        for (const item of data.items) {
          const date = new Date(item.pubDate);
          if (!Number.isFinite(+date)) continue;
          if (+date < cutoff) { reachedCutoff = true; continue; }
          const url = safeUrl(item.originallink) || safeUrl(item.link);
          if (!url) continue;
          batch.set(url, {url,naver_url:safeUrl(item.link),title:cleanText(item.title),
            description:cleanText(item.description),published_at:date.toISOString()});
        }
        // 기사와 검색어 연결을 한 SQL 문으로 저장: 네트워크 왕복을 페이지당 1회로 축소.
        // URL 중복은 위 Map에서 제거하여 한 행을 두 번 갱신하는 충돌을 방지.
        if (batch.size) {
          await query(`WITH input AS (
            SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
              url TEXT, naver_url TEXT, title TEXT, description TEXT, published_at TIMESTAMPTZ
            )
          ), upserted AS (
            INSERT INTO articles(url,naver_url,title,description,published_at)
            SELECT url,naver_url,title,description,published_at FROM input
            ON CONFLICT(url) DO UPDATE SET title=EXCLUDED.title,
              description=EXCLUDED.description,last_seen=NOW()
            RETURNING id
          )
          INSERT INTO article_queries(article_id,topic,keyword)
          SELECT id,$2,$3 FROM upserted ON CONFLICT DO NOTHING`,
          [JSON.stringify([...batch.values()]),topic,keyword]);
          fetched += batch.size;
        }
        console.log(`[${topic}] ${keyword}: ${Math.floor((start-1)/100)+1}페이지, ${batch.size}건 저장 · 누적 ${fetched}건 · ${Math.round((Date.now()-started)/1000)}초`);
        if (reachedCutoff || data.items.length<100) break;
        if (start===901) capped=true;
        await new Promise(r=>setTimeout(r,120));
      }
      if (capped) warnings.push(`${topic}/${keyword}: 조회 한도 1,000개 도달, 누락 가능`);
      await query('UPDATE collection_runs SET fetched=$2 WHERE id=$1',[run.id,fetched]);
    } catch(e) { errors.push(`${topic}/${keyword}: ${e.message}`); console.error(`[${topic}] ${keyword}: 실패 (${e.message})`); }
  }
  try {
    // 미완료인 오늘을 제외. 동일 요청의 5개 그룹을 함께 저장하여 정규화 기준 보존.
    console.log('검색어 트렌드 수집 시작');
    const end = Date.now()-86400000;
    const data = await naver('/search-trend/v1/search','TREND',{
      startDate:koreaDate(end-29*86400000),endDate:koreaDate(end),timeUnit:'date',keywordGroups:trendGroups
    });
    if (!Array.isArray(data.results)) throw new Error('트렌드 응답 형식 오류');
    await query('INSERT INTO trend_batches(payload) VALUES($1::jsonb)',[JSON.stringify(data)]);
    await query("DELETE FROM trend_batches WHERE fetched_at < NOW()-INTERVAL '90 days'");
  } catch(e) { errors.push(`트렌드: ${e.message}`); }
  await query("UPDATE collection_runs SET finished_at=NOW(),status=$2,fetched=$3,errors=$4::jsonb WHERE id=$1",[run.id,errors.length?(fetched?'partial':'failed'):'success',fetched,JSON.stringify([...errors,...warnings])]);
  console.log(JSON.stringify({status:errors.length?'partial':'success',processed:fetched,elapsedSeconds:Math.round((Date.now()-started)/1000),errors,warnings}));
  if (errors.length) process.exitCode=1;
} catch(e) {
  await query("UPDATE collection_runs SET finished_at=NOW(),status='failed',errors=$2::jsonb WHERE id=$1",[run.id,JSON.stringify([e.message])]);
  process.exitCode=1;
  console.error('수집 실패. DB 연결 및 설정을 확인하세요.');
} finally { await close(); }

}
collect().catch(async()=>{ console.error("수집 시작 실패. Secrets의 DATABASE_URL과 DB 상태를 확인하세요."); process.exitCode=1; await close(); });

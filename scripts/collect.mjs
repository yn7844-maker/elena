import {collectionWindow} from '../lib/schedule.mjs';
import {query,setup,close} from '../lib/db.mjs';
import {trendGroups,collectionCutoff,ARCHIVE_START,collectionPolicy} from '../lib/config.mjs';
import {naver} from '../lib/naver.mjs';
import {cleanText,safeUrl,koreaDate} from '../lib/core.mjs';
import {buildQueryPlan} from '../lib/discovery.mjs';

async function collect() {
// Check after runner setup, immediately before any DB/API work. Manual runs remain unrestricted.
if (process.env.COLLECTION_TRIGGER === 'schedule') {
  const window = collectionWindow();
  if (!window.allowed) {
    console.error(`::error::예약 수집 시작 허용 시간을 지났습니다. 현재 한국 시간 ${window.koreaTime}. 한국 시간 07·08·09·10·11·15·18·21시부터 5분 이내만 시작합니다. 이번 회차는 수집하지 않습니다.`);
    process.exitCode=1;
    return;
  }
  console.log(`예약 수집 시작: 한국 시간 ${window.koreaTime} (예정 ${window.scheduledAt})`);
} else {
  console.log('수동 수집 시작: 예약 시간 제한을 적용하지 않습니다.');
}
await setup();
const {rows:[run]} = await query('INSERT INTO collection_runs DEFAULT VALUES RETURNING id');
const errors = []; const warnings = []; let fetched = 0;
const started = Date.now();
let newsCalls = 0;
const newsFetcher = async (url,options)=>{
  if(newsCalls>=collectionPolicy.maxNewsCalls || Date.now()-started>=collectionPolicy.maxDurationMs)
    throw Object.assign(new Error('NAVER NEWS 수집 예산 도달'),{code:'COLLECTION_BUDGET'});
  newsCalls++;
  return fetch(url,options);
};
console.log('수집 시작: 검색어별 진행 상황을 아래에 표시합니다.');
try {
  const {rows:[last]} = await query("SELECT finished_at FROM collection_runs WHERE status IN ('success','partial') AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1");
  // 최초 실행은 10/26부터. 이후 48시간 겹쳐 조회하되 시작일 이전으로 내려가지 않습니다.
  const cutoff = collectionCutoff(last?.finished_at);
  console.log(`아카이브 시작: ${ARCHIVE_START} · 이번 조회 하한: ${new Date(cutoff).toISOString()}`);
  let history=[];
  try {
    const result=await query(`WITH ranked AS (
      SELECT a.url,a.title,a.description,q.topic,
        ROW_NUMBER() OVER(PARTITION BY q.topic ORDER BY a.published_at DESC,a.id DESC) AS rank
      FROM articles a JOIN (SELECT DISTINCT article_id,topic FROM article_queries) q ON q.article_id=a.id
      WHERE a.published_at >= GREATEST(NOW()-INTERVAL '7 days',$1::timestamptz)
    ) SELECT url,title,description,topic FROM ranked WHERE rank<=800`,[ARCHIVE_START]);
    history=result.rows;
  } catch {
    warnings.push('최근 기사 기반 후보 조회 실패: 기초·연관 검색어로 계속 수집합니다.');
  }
  const plan=buildQueryPlan(history,Number(run.id)-1);
  await query('UPDATE collection_runs SET search_plan=$2::jsonb WHERE id=$1',[run.id,JSON.stringify(plan)]);
  console.log('이번 수집 검색어: '+JSON.stringify(plan));
  collection: for (const [topic, searches] of Object.entries(plan)) for (const search of searches) {
    const {keyword,maxPages,kind}=search;
    try {
      let reachedCutoff = false, capped = false;
      console.log(`[${topic}] ${keyword}: ${kind} 검색 시작`);
      for (let start=1; start<maxPages*100; start+=100) {
        if(newsCalls>=collectionPolicy.maxNewsCalls || Date.now()-started>=collectionPolicy.maxDurationMs){
          warnings.push('실행당 호출량 또는 시간 한도 도달: 남은 검색어는 다음 예약 실행에서 다시 시도합니다.');
          break collection;
        }
        const data = await naver(`/search/v1/news?${new URLSearchParams({query:keyword,display:'100',start:String(start),sort:'date',format:'json'})}`, 'NEWS',undefined,newsFetcher);
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
        if (start===(maxPages-1)*100+1) capped=true;
        await new Promise(r=>setTimeout(r,120));
      }
      if (capped) warnings.push(`${topic}/${keyword}: 이번 조회 한도 ${maxPages*100}개 도달, 누락 가능`);
      await query('UPDATE collection_runs SET fetched=$2 WHERE id=$1',[run.id,fetched]);
    } catch(e) {
      if(e.code==='COLLECTION_BUDGET'){
        warnings.push('실행당 호출량 또는 시간 한도 도달: 남은 검색어는 다음 예약 실행에서 다시 시도합니다.');
        break collection;
      }
      errors.push(`${topic}/${keyword}: ${e.message}`);
      console.error(`[${topic}] ${keyword}: 실패 (${e.message})`);
    }
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
  console.log(JSON.stringify({status:errors.length?'partial':'success',processed:fetched,newsCalls,elapsedSeconds:Math.round((Date.now()-started)/1000),errors,warnings}));
  if (errors.length) process.exitCode=1;
} catch(e) {
  await query("UPDATE collection_runs SET finished_at=NOW(),status='failed',errors=$2::jsonb WHERE id=$1",[run.id,JSON.stringify([e.message])]);
  process.exitCode=1;
  console.error('수집 실패. DB 연결 및 설정을 확인하세요.');
} finally { await close(); }

}
collect().catch(async()=>{ console.error("수집 시작 실패. Secrets의 DATABASE_URL과 DB 상태를 확인하세요."); process.exitCode=1; await close(); });

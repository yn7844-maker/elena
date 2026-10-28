import {query,setup,close} from '../lib/db.mjs';
import {topics,trendGroups} from '../lib/config.mjs';
import {naver} from '../lib/naver.mjs';
import {cleanText,safeUrl,koreaDate} from '../lib/core.mjs';

await setup();
const {rows:[run]} = await query('INSERT INTO collection_runs DEFAULT VALUES RETURNING id');
const errors = []; let fetched = 0;
try {
  const {rows:[last]} = await query("SELECT finished_at FROM collection_runs WHERE status IN ('success','partial') AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1");
  // 마지막 수집부터 48시간을 겹쳐 수집. 최초 실행은 최근 7일. 쿼리당 최대 1,000개.
  const cutoff = last ? +new Date(last.finished_at)-2*86400000 : Date.now()-7*86400000;
  for (const [topic, queries] of Object.entries(topics)) for (const keyword of queries) {
    try {
      let reachedCutoff = false, capped = false;
      for (let start=1; start<=901; start+=100) {
        const data = await naver(`/search/v1/news?${new URLSearchParams({query:keyword,display:'100',start:String(start),sort:'date',format:'json'})}`, 'NEWS');
        if (!Array.isArray(data.items)) throw new Error('뉴스 응답 형식 오류');
        for (const item of data.items) {
          const date = new Date(item.pubDate);
          if (!Number.isFinite(+date)) continue;
          if (+date < cutoff) { reachedCutoff = true; continue; }
          const url = safeUrl(item.originallink) || safeUrl(item.link);
          if (!url) continue;
          const {rows:[a]} = await query(`INSERT INTO articles(url,naver_url,title,description,published_at)
            VALUES($1,$2,$3,$4,$5) ON CONFLICT(url) DO UPDATE SET
            title=EXCLUDED.title, description=EXCLUDED.description, last_seen=NOW() RETURNING id`,
            [url,safeUrl(item.link),cleanText(item.title),cleanText(item.description),date]);
          await query('INSERT INTO article_queries(article_id,topic,keyword) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[a.id,topic,keyword]);
          fetched++;
        }
        if (reachedCutoff || data.items.length<100) break;
        if (start===901) capped=true;
        await new Promise(r=>setTimeout(r,120));
      }
      if (capped) errors.push(`${topic}/${keyword}: 조회 한도 1,000개 도달, 누락 가능`);
    } catch(e) { errors.push(`${topic}/${keyword}: ${e.message}`); }
  }
  try {
    // 미완료인 오늘을 제외. 동일 요청의 5개 그룹을 함께 저장하여 정규화 기준 보존.
    const end = Date.now()-86400000;
    const data = await naver('/search-trend/v1/search','TREND',{
      startDate:koreaDate(end-29*86400000),endDate:koreaDate(end),timeUnit:'date',keywordGroups:trendGroups
    });
    if (!Array.isArray(data.results)) throw new Error('트렌드 응답 형식 오류');
    await query('INSERT INTO trend_batches(payload) VALUES($1::jsonb)',[JSON.stringify(data)]);
    await query("DELETE FROM trend_batches WHERE fetched_at < NOW()-INTERVAL '90 days'");
  } catch(e) { errors.push(`트렌드: ${e.message}`); }
  await query("UPDATE collection_runs SET finished_at=NOW(),status=$2,fetched=$3,errors=$4::jsonb WHERE id=$1",[run.id,errors.length?(fetched?'partial':'failed'):'success',fetched,JSON.stringify(errors)]);
  console.log(JSON.stringify({status:errors.length?'partial':'success',processed:fetched,errors}));
  if (errors.length) process.exitCode=1;
} catch(e) {
  await query("UPDATE collection_runs SET finished_at=NOW(),status='failed',errors=$2::jsonb WHERE id=$1",[run.id,JSON.stringify([e.message])]);
  process.exitCode=1;
  console.error('수집 실패. DB 연결 및 설정을 확인하세요.');
} finally { await close(); }

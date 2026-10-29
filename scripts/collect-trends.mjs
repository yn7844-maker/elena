import {query,setup,close} from '../lib/db.mjs';
import {trendGroups} from '../lib/config.mjs';
import {naver} from '../lib/naver.mjs';
import {collectTrends} from '../lib/trends.mjs';
try{
  await setup();
  const result=await collectTrends({query,keywordGroups:trendGroups,request:body=>naver('/search-trend/v1/search','TREND',body)});
  console.log(JSON.stringify({calls:result.calls,errorCount:result.errors.length}));
  if(result.errors.length){console.error('일부 검색 트렌드 수집에 실패했습니다. API 권한·사용 한도와 DB 상태를 확인하세요.');process.exitCode=1;}
}catch{
  console.error('검색 트렌드를 수집하지 못했습니다. GitHub Secrets의 DATABASE_URL과 트렌드 API 키를 확인하세요.');process.exitCode=1;
}finally{await close();}

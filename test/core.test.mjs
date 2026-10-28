import test from 'node:test';
import assert from 'node:assert/strict';
import {session,validSession,cleanText,safeUrl,koreaDate,keywords,rising} from '../lib/core.mjs';
import {naver} from '../lib/naver.mjs';
test('세션 서명 변조, 만료, 다른 키를 거부한다',()=>{
  const now=Date.now(),key='a'.repeat(32),token=session(key,now);
  assert.ok(validSession(token,key,now+10));
  assert.equal(validSession(token+'0',key,now),false);
  assert.equal(validSession(token,'b'.repeat(32),now),false);
  assert.equal(validSession(token,key,now+8*86400000),false);
  assert.equal(validSession('',key,now),false);
});
test('설명문 태그와 엔티티 정리, 외부 URL 프로토콜 제한',()=>{
  assert.equal(cleanText('<b>금리</b> &quot;인하&quot; &#xAC00;'),'금리 "인하" 가');
  assert.equal(safeUrl('javascript:alert(1)'),null);
  assert.equal(safeUrl('https://example.com/a'),'https://example.com/a');
});
test('한국 날짜는 UTC 자정이 아닌 한국 자정에 바뀐다',()=>{
  assert.equal(koreaDate(Date.parse('2026-10-27T16:00:00Z')),'2026-10-28');
});
test('한 기사에서 단어가 반복돼도 1건으로 집계한다',()=>{
  assert.equal(keywords([{title:'금리 금리 인하'},{title:'금리 동결'}]).find(x=>x.word==='금리').count,2);
});
test('급상승은 기사량 대신 언급 비중을 비교한다',()=>{
  const now=Date.now(),r=(title,days)=>({title,published_at:new Date(now-days*86400000).toISOString()});
  const rows=[r('금리',.1),r('금리',.2),r('금리',.3),r('문화',.4),r('금리',2),r('문화',3),r('공연',4),r('전시',5)];
  assert.equal(rising(rows,now).find(x=>x.word==='금리').change,50);
  assert.deepEqual(rising([r('금리',.1)],now),[]);
});
test('API HUB 헤더와 POST 본문, 인증 오류의 비재시도 확인',async()=>{
  process.env.NAVER_TREND_CLIENT_ID='test-id';process.env.NAVER_TREND_CLIENT_SECRET='test-secret';
  let calls=0;
  await naver('/search-trend/v1/search','TREND',{timeUnit:'date'},async(url,options)=>{
    calls++;assert.equal(url,'https://naverapihub.apigw.ntruss.com/search-trend/v1/search');
    assert.equal(options.headers['X-NCP-APIGW-API-KEY-ID'],'test-id');assert.equal(options.method,'POST');
    return new Response(JSON.stringify({results:[]}),{status:200});
  });
  assert.equal(calls,1);
  await assert.rejects(naver('/search-trend/v1/search','TREND',{},async()=>{calls++;return new Response('{}',{status:401});}),/HTTP 401/);
  assert.equal(calls,2);
});

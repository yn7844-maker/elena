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

test('수집 시작일은 한국 시간 10/26 자정으로 고정되고 이후 겹침 수집도 하한을 지킨다', async()=>{
  const {ARCHIVE_START,collectionCutoff}=await import('../lib/config.mjs');
  const start=Date.parse('2026-10-25T15:00:00Z');
  assert.equal(Date.parse(ARCHIVE_START),start);
  assert.equal(collectionCutoff(null),start);
  assert.equal(collectionCutoff('2026-10-27T00:00:00+09:00'),start);
  assert.equal(collectionCutoff('2026-10-30T12:00:00+09:00'),Date.parse('2026-10-28T12:00:00+09:00'));
});

test('공개 대시보드는 인증 설정 없이 조회되고 메모·저장 상태와 수정은 보호된다',async()=>{
  const {readFile}=await import('node:fs/promises');
  const originalPassword=process.env.ARCHIVE_PASSWORD, originalSecret=process.env.SESSION_SECRET;
  let writes=0;
  const fixture={id:'1',title:'금리 동향',published_at:new Date().toISOString(),topics:['금융'],saved:true,note:'비공개 메모'};
  globalThis.publicAccessTest={
    setup:async()=>{},
    query:async(sql)=>{
      if(sql.startsWith('SELECT a.*'))return {rows:[fixture]};
      if(sql.startsWith('SELECT MIN'))return {rows:[{first_seen:new Date(),total:1}]};
      if(sql.startsWith('UPDATE articles')){writes++;return {rowCount:1};}
      return {rows:[]};
    }
  };
  try {
    let source=await readFile(new URL('../api/index.mjs',import.meta.url),'utf8');
    source=source.replace("import {ARCHIVE_START} from '../lib/config.mjs';","const ARCHIVE_START='2026-10-26T00:00:00+09:00';")
      .replace("import {query,setup} from '../lib/db.mjs';","const {query,setup}=globalThis.publicAccessTest;")
      .replace("'../lib/core.mjs'",JSON.stringify(new URL('../lib/core.mjs',import.meta.url).href));
    const {default:handler}=await import('data:text/javascript,'+encodeURIComponent(source));
    async function invoke(route,method='GET',token){
      const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body}};
      await handler({url:'/api/index?route='+route,method,body:{id:'1',note:'수정'},headers:{host:'archive.test',origin:'https://archive.test',...(token?{cookie:'elena_session='+token}:{})}},res);
      return res;
    }
    delete process.env.ARCHIVE_PASSWORD;delete process.env.SESSION_SECRET;
    let res=await invoke('dashboard');
    assert.equal(res.code,200);assert.equal(res.body.canEdit,false);
    assert.equal(res.body.articles[0].note,'');assert.equal(res.body.articles[0].saved,false);
    assert.equal((await invoke('article','PATCH')).code,401);
    assert.equal((await invoke('dashboard&saved=1')).code,401);assert.equal(writes,0);
    process.env.ARCHIVE_PASSWORD='password';process.env.SESSION_SECRET='abcdefghijkl';
    const token=session(process.env.SESSION_SECRET);
    res=await invoke('dashboard','GET',token);
    assert.equal(res.code,200);assert.equal(res.body.canEdit,true);assert.equal(res.body.articles[0].note,'비공개 메모');
    assert.equal((await invoke('article','PATCH',token)).code,200);assert.equal(writes,1);
  } finally {
    if(originalPassword===undefined)delete process.env.ARCHIVE_PASSWORD;else process.env.ARCHIVE_PASSWORD=originalPassword;
    if(originalSecret===undefined)delete process.env.SESSION_SECRET;else process.env.SESSION_SECRET=originalSecret;
    delete globalThis.publicAccessTest;
  }
});

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

test('대시보드는 공개 조회 전용이며 기존 쿠키로도 공유 메모를 읽거나 수정할 수 없다',async()=>{
  const {readFile}=await import('node:fs/promises');
  let writes=0;
  globalThis.personalApiTest={
    setup:async()=>{},
    query:async(sql)=>{
      if(sql.startsWith('SELECT a.'))return {rows:[{id:'1',title:'금리 동향',published_at:new Date().toISOString(),topics:['금융'],saved:true,note:'기존 공유 메모'}]};
      if(sql.startsWith('SELECT MIN'))return {rows:[{first_seen:new Date(),total:1}]};
      if(!sql.startsWith('SELECT'))writes++;
      return {rows:[]};
    }
  };
  try{
    let source=await readFile(new URL('../api/index.mjs',import.meta.url),'utf8');
    source=source.replace("import {ARCHIVE_START} from '../lib/config.mjs';","const ARCHIVE_START='2026-10-26T00:00:00+09:00';")
      .replace("import {query,setup} from '../lib/db.mjs';","const {query,setup}=globalThis.personalApiTest;")
      .replace("'../lib/core.mjs'",JSON.stringify(new URL('../lib/core.mjs',import.meta.url).href));
    const {default:handler}=await import('data:text/javascript,'+encodeURIComponent(source));
    async function invoke(route,method='GET'){
      const res={headers:{},setHeader(k,v){this.headers[k]=v},status(code){this.code=code;return this},json(body){this.body=body}};
      await handler({url:'/api/index?route='+route,method,body:{id:'1',note:'외부 수정'},headers:{cookie:'elena_session=obsolete'}},res);return res;
    }
    let res=await invoke('dashboard');assert.equal(res.code,200);
    assert.equal('note' in res.body.articles[0],false);assert.equal('saved' in res.body.articles[0],false);
    assert.match(res.headers['Set-Cookie'],/Max-Age=0/);
    assert.equal((await invoke('article','PATCH')).code,405);
    assert.equal((await invoke('login','POST')).code,405);
    assert.equal((await invoke('login')).code,404);assert.equal(writes,0);
  }finally{delete globalThis.personalApiTest;}
});

test('DB 오류 진단은 원문 연결 정보 없이 안전한 코드와 실패 단계만 반환한다',async()=>{
  const {readFile}=await import('node:fs/promises');
  globalThis.dbDiagnosticTest={query:async()=>({rows:[]}),setup:async()=>{
    throw Object.assign(new Error('postgresql://private-user:private-password@private-host/database'),{code:'28P01'});
  }};
  try {
    let source=await readFile(new URL('../api/index.mjs',import.meta.url),'utf8');
    source=source.replace("import {ARCHIVE_START} from '../lib/config.mjs';","const ARCHIVE_START='2026-10-26T00:00:00+09:00';")
      .replace("import {query,setup} from '../lib/db.mjs';","const {query,setup}=globalThis.dbDiagnosticTest;")
      .replace("'../lib/core.mjs'",JSON.stringify(new URL('../lib/core.mjs',import.meta.url).href));
    const {default:handler}=await import('data:text/javascript,'+encodeURIComponent(source));
    const response={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body}};
    await handler({url:'/api/index?route=dashboard',method:'GET',headers:{}},response);
    assert.equal(response.code,503);assert.equal(response.body.code,'28P01');
    assert.equal(response.body.stage,'database-setup');
    assert.ok(!JSON.stringify(response.body).includes('private-password'));
    assert.ok(!JSON.stringify(response.body).includes('private-host'));
  } finally {delete globalThis.dbDiagnosticTest;}
});

test('수집 계획은 기초 검색어와 순환 연관어를 포함하고 실행별로 확장어를 바꾼다',async()=>{
  const {buildQueryPlan}=await import('../lib/discovery.mjs');
  const {topics,collectionPolicy}=await import('../lib/config.mjs');
  const first=buildQueryPlan([],0),next=buildQueryPlan([],1);
  assert.deepEqual(Object.keys(first),Object.keys(topics));
  for(const topic of Object.keys(topics)){
    assert.deepEqual(first[topic].filter(q=>q.kind==='core').map(q=>q.keyword),topics[topic]);
    assert.equal(first[topic].filter(q=>q.kind==='related').length,3);
    assert.notDeepEqual(first[topic].filter(q=>q.kind==='related'),next[topic].filter(q=>q.kind==='related'));
    assert.equal(new Set(first[topic].map(q=>q.keyword.toLowerCase())).size,first[topic].length);
  }
  const maxBaseCalls=Object.values(first).flat().reduce((sum,q)=>sum+q.maxPages,0);
  const maxDiscoveredCalls=Object.keys(topics).length*collectionPolicy.discoveredPerTopic*collectionPolicy.expandedPages;
  assert.ok(maxBaseCalls+maxDiscoveredCalls<=collectionPolicy.maxNewsCalls);
});
test('기사 기반 확장은 URL 중복을 제외하고 3건·2사이트의 근거와 주제 문맥을 요구한다',async()=>{
  const {buildQueryPlan}=await import('../lib/discovery.mjs');
  const row=(host,id,title='네오증권 주식',topic='금융')=>({url:'https://'+host+'/'+id,title,description:'',topic});
  const base=[row('one.example',1),row('two.example',2),row('one.example',3)];
  let plan=buildQueryPlan([...base,base[0]],0);
  const found=plan['금융'].filter(q=>q.kind==='discovered');
  assert.equal(found.length,1);assert.equal(found[0].keyword,'네오증권 주식');assert.equal(found[0].evidenceCount,3);
  assert.equal(buildQueryPlan(base.slice(0,2),0)['금융'].filter(q=>q.kind==='discovered').length,0);
  assert.equal(buildQueryPlan([row('one.example',1),row('one.example',2),row('one.example',3)],0)['금융'].filter(q=>q.kind==='discovered').length,0);
  assert.equal(buildQueryPlan(base.map(r=>({...r,title:'연극 공연'})),0)['금융'].filter(q=>q.kind==='discovered').length,0);
  assert.equal(buildQueryPlan(base.map(r=>({...r,topic:'AI',title:'chair 새소식'})),0).AI.filter(q=>q.kind==='discovered').length,0);
});

test('개인 저장은 브라우저별로 격리되고 재로드 후 유지되며 서버 메모를 자동 복사하지 않는다',async()=>{
  const {createPersonalStore,PERSONAL_STORAGE_KEY}=await import('../personal-store.js');
  const memory=new Map(),storage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)};
  const article={id:'1',url:'https://example.com/news',title:'개인 기사',description:'설명',published_at:new Date().toISOString(),topics:['AI'],saved:true,note:'서버 공유 메모'};
  const store=createPersonalStore(()=>storage);
  store.write(article,{saved:true});
  assert.equal(createPersonalStore(()=>storage).read()[article.url].saved,true);
  assert.equal(store.read()[article.url].note,'');
  store.write(article,{note:'내 메모'});store.write(article,{saved:false});
  assert.equal(store.read()[article.url].note,'내 메모');assert.equal(store.read()[article.url].saved,false);
  assert.ok(memory.get(PERSONAL_STORAGE_KEY).includes('내 메모'));
  const other=createPersonalStore(()=>({getItem:()=>null,setItem(){}}));
  assert.equal(Object.keys(other.read()).length,0);
  store.write(article,{note:''});assert.equal(Object.keys(store.read()).length,0);
});
test('개인 저장 실패와 손상 데이터는 성공으로 처리하지 않는다',async()=>{
  const {createPersonalStore}=await import('../personal-store.js');
  const article={url:'https://example.com/news',title:'기사',published_at:new Date().toISOString(),topics:['금융']};
  const blocked=createPersonalStore(()=>({getItem:()=>null,setItem(){throw new Error('quota');}}));
  assert.throws(()=>blocked.write(article,{saved:true}),/quota/);
  assert.throws(()=>createPersonalStore(()=>({getItem:()=>'{bad json'})).read());
  assert.throws(()=>createPersonalStore(()=>{throw new Error('blocked')}).read(),/blocked/);
});

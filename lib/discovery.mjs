import {topics,topicProfiles,collectionPolicy} from './config.mjs';
import {words} from './core.mjs';

const generic=new Set('발표 공개 추진 확대 강화 지원 사업 진행 예정 이번 최근 관련 대한 위한 이후 가운데 것으로 것이다 밝혔다 있는 없는 된다 한다 대한 국내 해외 세계 올해 내년 기자 뉴스 속보 단독 종합 지금 오늘 내일 사람 우리 여러분 관심 주목 전망 가능 논의 증가 감소 변화 정부 서울 한국'.split(' '));
const normalized=s=>String(s).normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
function mentions(text,term) {
  const needle=normalized(term),haystack=normalized(text);
  if(/^[a-z]+$/.test(needle)) {
    return new RegExp('(^|[^a-z])'+needle+'($|[^a-z])','i').test(haystack);
  }
  return haystack.includes(needle);
}
function candidatesFor(topic,history) {
  const profile=topicProfiles[topic],known=new Set([...topics[topic],...profile.related,...profile.anchors].map(normalized));
  const seen=new Set(),candidates=new Map();
  for(const row of history) {
    if(row.topic!==topic||seen.has(row.url))continue;
    let host;
    try {host=new URL(row.url).hostname.replace(/^www\./,'');} catch {continue;}
    seen.add(row.url);
    // 기사 문맥에서 확인한 주제 단어를 검색어에도 붙여 다른 분야로의 이탈을 줄입니다.
    const anchor=profile.anchors.find(a=>mentions(row.title+' '+(row.description||''),a));
    if(!anchor)continue;
    for(const word of words(row.title)) {
      const key=normalized(word);
      if(known.has(key)||generic.has(key)||key.length<2||key.length>18||/(했다|한다|됐다|된다|있다|없다|이다|위해|관련|대한)$/.test(key))continue;
      let entry=candidates.get(key);
      if(!entry) {entry={word,urls:new Set(),hosts:new Set(),anchors:new Map()};candidates.set(key,entry);}
      entry.urls.add(row.url);entry.hosts.add(host);entry.anchors.set(anchor,(entry.anchors.get(anchor)||0)+1);
    }
  }
  return [...candidates.values()].filter(c=>c.urls.size>=3&&c.hosts.size>=2)
    .sort((a,b)=>b.urls.size-a.urls.size||a.word.localeCompare(b.word))
    .map(c=>({keyword:c.word+' '+[...c.anchors].sort((a,b)=>b[1]-a[1])[0][0],evidenceCount:c.urls.size}));
}
export function buildQueryPlan(history=[],rotation=0) {
  const plan={};
  for(const [topic,seeds] of Object.entries(topics)) {
    const profile=topicProfiles[topic],queries=[],seen=new Set();
    const add=(keyword,kind,maxPages,evidenceCount)=>{
      const key=normalized(keyword);if(!key||seen.has(key))return;seen.add(key);
      queries.push({keyword,kind,maxPages,...(evidenceCount?{evidenceCount}:{})});
    };
    seeds.forEach(s=>add(s,'core',collectionPolicy.corePages));
    const offset=(Math.max(0,Number(rotation)||0)*collectionPolicy.relatedPerTopic)%profile.related.length;
    for(let i=0;i<Math.min(collectionPolicy.relatedPerTopic,profile.related.length);i++)
      add(profile.related[(offset+i)%profile.related.length],'related',collectionPolicy.expandedPages);
    candidatesFor(topic,history).slice(0,collectionPolicy.discoveredPerTopic)
      .forEach(c=>add(c.keyword,'discovered',collectionPolicy.expandedPages,c.evidenceCount));
    plan[topic]=queries;
  }
  return plan;
}

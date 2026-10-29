import {createPersonalStore,PERSONAL_STORAGE_KEY} from './personal-store.js';
const $ = s => document.querySelector(s);
const state = {topic:'',saved:false,days:7,search:'',page:1,data:null};
const colors=['#315e50','#9aaf62','#c28b55','#7e8bb0','#bc7e8c'];
let requestNumber=0;
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const date=(v,full=false)=>v?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',...(full?{hour:'2-digit',minute:'2-digit'}:{})}).format(new Date(v)):'—';
const timestamp=v=>{
  if(!v||!Number.isFinite(new Date(v).getTime()))return '시각 정보 없음';
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(v)).map(p=>[p.type,p.value]));
  return `${parts.year}.${parts.month}.${parts.day} ${parts.hour}:${parts.minute}`;
};
function publishedTime(value){
  const time=el('time',`기사 게시 ${timestamp(value)} (한국 시간)`);
  if(value&&Number.isFinite(new Date(value).getTime()))time.dateTime=new Date(value).toISOString();
  time.title='네이버가 제공한 기사 발행 시각';
  return time;
}
const personalStore=createPersonalStore();
let personalEntries=Object.create(null),storageWarning='';
function readPersonal(){
  try{personalEntries=personalStore.read();storageWarning='';}
  catch{personalEntries=Object.create(null);storageWarning='브라우저의 개인 저장 데이터를 읽을 수 없습니다. 저장 권한과 브라우저 설정을 확인하세요.';}
}
readPersonal();
function savePersonal(article,patch){
  try{personalEntries=personalStore.write(article,patch);storageWarning='';}
  catch{throw new Error('개인 저장에 실패했습니다. 브라우저 저장 공간이나 사이트 저장 권한을 확인하세요.');}
}
function savedArticles(){
  const live=new Map((state.data?.articles||[]).map(row=>[row.url,row]));
  const cutoff=state.days===0?0:Date.now()-state.days*86400000;
  const search=state.search.toLowerCase();
  return Object.values(personalEntries).filter(entry=>entry.saved||entry.note)
    .map(entry=>({...entry,...live.get(entry.url),saved:entry.saved,note:entry.note}))
    .filter(row=>(!state.topic||row.topics.includes(state.topic))&&
      new Date(row.published_at).getTime()>=cutoff&&
      (row.title+' '+row.description).toLowerCase().includes(search))
    .sort((a,b)=>new Date(b.published_at)-new Date(a.published_at));
}
function visibleArticles(){
  if(state.saved)return savedArticles();
  return (state.data?.articles||[]).map(row=>({...row,saved:personalEntries[row.url]?.saved===true,note:personalEntries[row.url]?.note||''}));
}
async function api(route) {
  const response=await fetch('/api/index?route='+route);
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'요청을 완료하지 못했습니다.');
  return data;
}
function notify(message){$('#notice').textContent=message;$('#notice').hidden=!message;}
async function load(){
  const serial=++requestNumber;
  if(state.saved){state.page=1;render();$('#refresh').disabled=false;return;}
  $('#refresh').disabled=true;
  try{
    const params=new URLSearchParams({days:state.days,topic:state.topic,search:state.search});
    const data=await api(`dashboard&${params}`);
    if(serial!==requestNumber)return;
    state.data=data;state.page=1;
    render();
  }catch(e){if(serial!==requestNumber)return;notify(e.message);}
  finally{if(serial===requestNumber)$('#refresh').disabled=false;}
}
$('#today').textContent=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric'}).format(new Date());
$('#refresh').onclick=load;
function chooseTopic(event){
  const button=event.target.closest('button[data-topic]');
  if(!button)return;
  state.topic=button.dataset.topic;state.saved=false;load();
}
$('#topics').onclick=chooseTopic;
$('#article-topics').onclick=chooseTopic;
$('#saved').onclick=()=>{state.saved=!state.saved;load();};
$('#filters').onsubmit=e=>{e.preventDefault();state.search=$('#search').value.trim();load();};
$('#days').onchange=e=>{state.days=Number(e.target.value);load();};
$('#clear').onclick=()=>{Object.assign(state,{topic:'',saved:false,days:7,search:''});$('#search').value='';$('#days').value='7';load();};
function keywordSearch(word){$('#search').value=word;state.search=word;load();}
function render(){
  const d=state.data||{articles:[],keywords:[],rising:[],risingReady:false,capped:false,runs:[],trends:null,coverage:{total:0}},a=visibleArticles();
  $('.analysis-grid').hidden=state.saved;
  $('#saved-count').textContent=savedArticles().length.toLocaleString();
  document.querySelectorAll('#topics button').forEach(b=>b.classList.toggle('active',b.dataset.topic===state.topic&&!state.saved));
  document.querySelectorAll('#article-topics button').forEach(button=>{
    const active=button.dataset.topic===state.topic;
    button.classList.toggle('active',active);
    button.setAttribute('aria-pressed',String(active));
  });
  $('#saved').classList.toggle('active',state.saved);
  $('#article-count').textContent=a.length.toLocaleString();

  $('#top-word-label').textContent=state.saved?'저장 위치':'주요 제목 단어';
  $('#top-word').textContent=state.saved?'이 브라우저':d.keywords[0]?.word||'—';
  $('#top-word-caption').textContent=state.saved?'다른 사람·기기와 공유되지 않음':'최근 수집 구간 기준';
  const complete=d.runs.find(r=>r.finished_at);
  const scope=d.keywordScope;
  $('#keyword-period').textContent=scope?.current?`집계: ${timestamp(scope.current.startAt)} ~ ${timestamp(scope.current.endAt)} (한국 시간)`:'수집 완료 후 집계됩니다.';
  $('#keyword-asof').textContent=scope?.previous?`비교: ${timestamp(scope.previous.startAt)} ~ ${timestamp(scope.previous.endAt)}`:'이전 수집 구간이 없어 신규 비교는 다음 수집부터 표시합니다.';
  $('#keyword-scope').textContent=scope?.current?`${scope.topic||'전체'} · ${(scope.articleCount||0).toLocaleString()}건 분석${scope.search?` · 검색어 “${scope.search}”`:''}`:'';
  $('#last-run').textContent=date(complete?.finished_at,true);
  $('#run-state').textContent=complete?({success:'정상 수집 완료',partial:'일부 수집 실패 · 아래 상태 확인',failed:'수집 실패 · 아래 상태 확인'}[complete.status]||complete.status):'수집 이력이 없습니다.';
  const messages=[];
  if(!a.length&&!state.saved)messages.push(d.coverage.total?'현재 조건에 해당하는 기사가 없습니다. 기간이나 필터를 바꿔보세요.':'아직 수집된 기사가 없습니다. 잠시 후 다시 확인해 주세요.');
  if(d.capped&&!state.saved)messages.push('조회 범위가 5,000건을 초과해 기사 목록과 급상승은 최신 5,000건으로 제한합니다. 수집 구간 키워드는 해당 구간 전체를 집계합니다.');
  if(complete&&complete.status!=='success')messages.push('최근 수집에 오류가 있습니다. 페이지 아래 수집 상태를 확인하세요.');
  if(complete&&Date.now()-new Date(complete.finished_at)>12*3600000)messages.push('마지막 수집이 12시간 이상 지났습니다. GitHub Actions 예약 상태를 확인하세요.');
  if(storageWarning)messages.push(storageWarning);
  notify(messages.join(' '));
  const chips=$('#keywords');chips.replaceChildren();
  d.keywords.forEach(k=>{
    const b=el('button',undefined,k.isNew?'chip chip-new':'chip');
    b.append(el('span',k.word));
    if(k.isNew){b.append(el('span','▲','keyword-new-mark'));b.setAttribute('aria-label',`${k.word} ${k.count}건 · 이전 구간 상위 목록 대비 신규`);b.title='이전 수집 구간의 상위 18개 목록에 새로 진입한 키워드';}
    b.append(el('small',`${k.count}건`));b.onclick=()=>keywordSearch(k.word);chips.append(b);
  });
  if(!d.keywords.length)chips.append(el('p',scope?.current?'이 수집 구간에 분석할 기사가 없습니다.':'수집 완료 후 키워드가 표시됩니다.','empty'));
  const rising=$('#rising');rising.replaceChildren();
  d.rising.forEach(k=>{const b=el('button');b.append(el('span',k.word),el('em',`+${k.change.toFixed(1)}%p`));b.onclick=()=>keywordSearch(k.word);rising.append(b);});
  if(!d.rising.length)rising.append(el('p',d.risingReady?'현재 조건에서 상승 기준에 해당하는 단어가 없습니다.':'수집 이력이 8일 이상 쌓이고 비교 기사가 확보되면 표시합니다.','fine'));
  $('#list-title').textContent=state.saved?'저장한 이야기':'오늘의 발견';
  $('#scope-label').textContent=`${state.topic||'전체'} · 최신순 · ${state.days===0?'전체 기간':'최근 '+(state.days===1?'24시간':state.days+'일')} · ${a.length.toLocaleString()}건`;
  renderArticles();renderTrend(d.trends);
  const runs=$('#runs');runs.replaceChildren();
  d.runs.forEach(r=>{const item=el('div',`${date(r.started_at,true)} · ${r.status} · ${r.fetched}건 처리`,'run-row');(r.errors||[]).forEach(error=>item.append(el('div',error,'error')));
    if(r.search_plan&&Object.keys(r.search_plan).length){
      const detail=el('details'),summary=el('summary','이번 수집에 사용한 검색어');
      detail.append(summary);
      Object.entries(r.search_plan).forEach(([topic,queries])=>{
        const line=el('p',topic+' · '+queries.map(q=>q.keyword+(q.kind==='discovered'?' (기사에서 발견)':q.kind==='related'?' (연관)':'')).join(', '));
        detail.append(line);
      });
      item.append(detail);
    }
    runs.append(item);});
}
function renderArticles(){
  const list=$('#articles');list.replaceChildren();
  const rows=visibleArticles();
  state.page=Math.max(1,Math.min(state.page,Math.ceil(rows.length/15)||1));
  const start=(state.page-1)*15;
  rows.slice(start,start+15).forEach(a=>{
    const item=el('article',undefined,'news-item'),content=el('div'),meta=el('div',undefined,'news-meta');
    a.topics.forEach(t=>meta.append(el('span',t,'tag')));meta.append(publishedTime(a.published_at));
    const h=el('h3'),open=el('button',a.title);open.onclick=()=>detail(a);h.append(open);
    content.append(meta,h,el('p',a.description,'news-description'));
    if(a.note)content.append(el('div','메모가 있는 기사','note-mark'));
    const actions=el('div',undefined,'news-actions'),save=el('button',a.saved?'★':'☆',`bookmark${a.saved?' is-saved':''}`);
    save.setAttribute('aria-label',a.saved?'즐겨찾기 해제':'즐겨찾기 저장');save.setAttribute('aria-pressed',String(a.saved));
    save.onclick=()=>{try{savePersonal(a,{saved:!a.saved});render();}catch(e){notify(e.message);}};
    const link=el('a','원문 보기 ↗');link.href=a.url;link.target='_blank';link.rel='noopener noreferrer';
    actions.append(save,link);item.append(content,actions);list.append(item);
  });
  if(!rows.length)list.append(el('div',state.saved?'현재 조건에 맞는 개인 저장 기사가 없습니다. 기사 옆 별표를 눌러 저장해 보세요.':'기사 수집 후 이곳에 새로운 이야기가 쌓입니다.','empty'));
  const max=Math.max(1,Math.ceil(rows.length/15));$('#page-label').textContent=`${state.page} / ${max}`;$('#prev').disabled=state.page===1;$('#next').disabled=state.page===max;
}
$('#prev').onclick=()=>{state.page--;renderArticles();};$('#next').onclick=()=>{state.page++;renderArticles();};
$('#close-dialog').onclick=()=>$('#article-dialog').close();
function detail(a){
  const box=$('#article-detail');box.replaceChildren();
  const meta=el('div',undefined,'news-meta');meta.append(el('span',a.topics.join(' · ')),publishedTime(a.published_at));
  box.append(meta,el('h2',a.title),el('p',a.description),el('small','네이버 검색 결과 설명문입니다. 기사 전문은 원문에서 확인하세요.','fine'));
  const label=el('label','나만의 메모 · 이 브라우저에 저장');label.htmlFor='note';
  const note=el('textarea');note.id='note';note.value=a.note;note.maxLength=5000;
  const actions=el('div',undefined,'detail-actions'),save=el('button','메모 저장','primary'),link=el('a','기사 원문 보기 ↗'),message=el('div','','detail-feedback');message.setAttribute('role','status');
  link.href=a.url;link.target='_blank';link.rel='noopener noreferrer';
  save.onclick=()=>{try{savePersonal(a,{note:note.value});a.note=note.value;message.textContent='이 브라우저에 저장했습니다.';render();}catch(e){message.textContent=e.message;}};
  actions.append(save,link);box.append(label,note,actions,message);$('#article-dialog').showModal();
}
const hotTopicCache=new Map();
let dismissTrendPopup=()=>{};
document.addEventListener('pointerdown',event=>{if(!$('#trend-chart').contains(event.target))dismissTrendPopup();});
function renderTrend(batch){
  dismissTrendPopup();
  const chart=$('#trend-chart'),legend=$('#trend-legend'),table=$('#trend-table');chart.replaceChildren();legend.replaceChildren();table.replaceChildren();
  if(!batch?.payload?.results?.length){chart.append(el('div','검색어 트렌드 수집 결과가 아직 없습니다.','empty'));$('#trend-info').textContent='트렌드 API 인증 정보와 수집 실행 결과를 확인하세요.';return;}
  const points=[];
  const data=batch.payload,groups=data.results,dates=[...new Set(groups.flatMap(g=>g.data.map(p=>p.period)))].sort();
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 520 210');svg.setAttribute('role','img');svg.setAttribute('aria-label','최근 30일 검색 관심도. 상세 값은 아래 날짜별 표에서 확인할 수 있습니다.');
  const add=(tag,attrs,text)=>{const n=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;svg.append(n);return n;};
  [0,25,50,75,100].forEach(n=>{const y=175-n*1.5;add('line',{x1:32,x2:505,y1:y,y2:y,stroke:'#e8ede7','stroke-dasharray':'3 4'});add('text',{x:2,y:y+4,fill:'#87918b','font-size':10},n);});
  groups.forEach((g,i)=>{
    const map=new Map(g.data.map(p=>[p.period,p.ratio]));let path='',connected=false;
    dates.forEach((d,j)=>{const n=map.get(d);if(n==null){connected=false;return;}const x=32+j/Math.max(1,dates.length-1)*473,y=175-Math.max(0,Math.min(100,n))*1.5;path+=`${connected?'L':'M'}${x},${y} `;connected=true;points.push({x,y,date:d,dateIndex:j,groupIndex:i,group:g.title,ratio:n});const dot=add('circle',{cx:x,cy:y,r:1.8,fill:colors[i%5]});dot.setAttribute('data-trend-date',d);dot.setAttribute('data-trend-group',g.title);});
    add('path',{d:path,fill:'none',stroke:colors[i%5],'stroke-width':2});
    const l=el('span'),dot=el('i');dot.style.backgroundColor=colors[i%5];l.append(dot,document.createTextNode(g.title));legend.append(l);
  });
  if(dates.length){add('text',{x:32,y:198,fill:'#87918b','font-size':10},dates[0].slice(5));add('text',{x:470,y:198,fill:'#87918b','font-size':10},dates.at(-1).slice(5));}chart.append(svg);attachTrendTopics(chart,svg,dates,groups,points);
  $('#trend-info').textContent=`${data.startDate} ~ ${data.endDate} · ${date(batch.fetched_at,true)} 갱신. 동일 요청 내 최대 검색량을 100으로 한 상대 지수이며 실제 검색 횟수가 아닙니다. 위 기사 필터와 별도로 고정 5개 그룹을 비교합니다.`;
  const t=el('table'),head=el('tr');['날짜',...groups.map(g=>g.title)].forEach(x=>head.append(el('th',x)));t.append(head);
  dates.forEach(d=>{const row=el('tr');row.append(el('td',d));groups.forEach(g=>{const n=g.data.find(p=>p.period===d)?.ratio;row.append(el('td',n==null?'—':Number(n).toFixed(1)));});t.append(row);});table.append(t);
}
window.addEventListener('storage',event=>{
  if(event.key===PERSONAL_STORAGE_KEY||event.key===null){readPersonal();if(state.data||state.saved)render();}
});

function attachTrendTopics(chart,svg,dates,groups,points){
  if(!points.length)return;
  const popup=el('div',undefined,'trend-tooltip');popup.hidden=true;popup.setAttribute('role','status');popup.setAttribute('aria-live','polite');chart.append(popup);
  svg.setAttribute('tabindex','0');
  svg.setAttribute('aria-label','검색 관심도 그래프. 마우스 또는 터치로 날짜를 선택하면 관련 기사 Hot topics를 확인할 수 있습니다. 키보드 좌우로 날짜, 위아래로 항목을 선택합니다.');
  const ns='http://www.w3.org/2000/svg',guide=document.createElementNS(ns,'line'),marker=document.createElementNS(ns,'circle');
  for(const [key,value]of Object.entries({y1:20,y2:175,stroke:'#758a80','stroke-dasharray':'3 4','pointer-events':'none'}))guide.setAttribute(key,value);
  for(const [key,value]of Object.entries({r:4,stroke:'#fff','stroke-width':2,'pointer-events':'none'}))marker.setAttribute(key,value);
  svg.append(guide,marker);
  let activeKey='',timer,hideTimer,generation=0,current=points.at(-1);
  function hide(){
    generation++;clearTimeout(timer);clearTimeout(hideTimer);popup.hidden=true;activeKey='';
    guide.setAttribute('visibility','hidden');marker.setAttribute('visibility','hidden');
  }
  dismissTrendPopup=hide;hide();
  function place(point){
    const p=svg.createSVGPoint();p.x=point.x;p.y=point.y;
    const screen=p.matrixTransform(svg.getScreenCTM()),bounds=chart.getBoundingClientRect();
    const width=popup.getBoundingClientRect().width;
    popup.style.left=Math.max(0,Math.min(bounds.width-width,screen.x-bounds.left+14))+'px';
    const height=popup.getBoundingClientRect().height;
    popup.style.top=Math.max(0,screen.y-bounds.top+height+14>bounds.height?screen.y-bounds.top-height-12:screen.y-bounds.top+14)+'px';
  }
  function content(point,data,error){
    popup.replaceChildren();
    popup.append(el('strong',point.group+' · '+point.date),el('div','검색 관심도 '+Number(point.ratio).toFixed(1),'trend-tooltip-ratio'),el('h3','Hot topics · 최대 10개'));
    if(error)popup.append(el('p','관련 키워드를 불러오지 못했습니다. 잠시 후 다시 확인하세요.','fine'));
    else if(!data)popup.append(el('p','관련 기사를 확인하고 있습니다.','fine'));
    else if(!data.topics.length)popup.append(el('p',data.message||'해당 날짜에 수집된 관련 기사가 없습니다.','fine'));
    else {
      const list=el('ol');
      data.topics.forEach(topic=>{const item=el('li');item.append(el('span',topic.word),el('small',topic.count+'건'));list.append(item);});
      popup.append(list,el('p',(data.capped?'최신 '+data.articleCount+'건':'관련 기사 '+data.articleCount+'건')+'의 제목 기준','fine'));
    }
    place(point);
  }
  function show(point){
    clearTimeout(hideTimer);
    const key=point.date+'|'+point.group;
    if(key===activeKey&&!popup.hidden)return;
    current=point;activeKey=key;const version=++generation;clearTimeout(timer);
    guide.setAttribute('x1',point.x);guide.setAttribute('x2',point.x);guide.removeAttribute('visibility');
    marker.setAttribute('cx',point.x);marker.setAttribute('cy',point.y);marker.setAttribute('fill',colors[point.groupIndex%5]);marker.removeAttribute('visibility');
    popup.hidden=false;
    const cached=hotTopicCache.get(key);
    if(cached&&Date.now()-cached.at<300000){content(point,cached.data);return;}
    content(point);
    timer=setTimeout(async()=>{
      try{
        const data=await api('hot-topics&'+new URLSearchParams({date:point.date,group:point.group}));
        hotTopicCache.set(key,{at:Date.now(),data});
        if(hotTopicCache.size>200)hotTopicCache.delete(hotTopicCache.keys().next().value);
        if(version===generation&&!popup.hidden)content(point,data);
      }catch{if(version===generation&&!popup.hidden){activeKey='';content(point,null,true);}}
    },180);
  }
  function nearest(event){
    const p=svg.createSVGPoint();p.x=event.clientX;p.y=event.clientY;
    const local=p.matrixTransform(svg.getScreenCTM().inverse());
    if(local.x<25||local.x>515||local.y<10||local.y>185)return null;
    return points.reduce((best,point)=>Math.hypot(point.x-local.x,point.y-local.y)<Math.hypot(best.x-local.x,best.y-local.y)?point:best,points[0]);
  }
  svg.addEventListener('pointermove',event=>{if(event.pointerType==='touch')return;const point=nearest(event);if(point)show(point);else hide();});
  svg.addEventListener('click',event=>{const point=nearest(event);if(point)show(point);});
  svg.addEventListener('pointerleave',event=>{if(event.pointerType!=='touch')hideTimer=setTimeout(hide,180);});
  popup.addEventListener('pointerenter',()=>clearTimeout(hideTimer));
  popup.addEventListener('pointerleave',hide);
  svg.addEventListener('keydown',event=>{
    if(event.key==='Escape'){hide();return;}
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter',' '].includes(event.key))return;
    event.preventDefault();
    const dx=event.key==='ArrowLeft'?-1:event.key==='ArrowRight'?1:0;
    const dy=event.key==='ArrowUp'?-1:event.key==='ArrowDown'?1:0;
    const dateIndex=Math.max(0,Math.min(dates.length-1,current.dateIndex+dx));
    const groupIndex=(current.groupIndex+dy+groups.length)%groups.length;
    const point=points.find(p=>p.dateIndex===dateIndex&&p.groupIndex===groupIndex);
    if(point)show(point);
  });
  svg.addEventListener('blur',hide);
}

load();

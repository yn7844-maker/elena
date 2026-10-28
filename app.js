const $ = s => document.querySelector(s);
const state = {topic:'',saved:false,days:7,search:'',page:1,data:null};
const colors=['#315e50','#9aaf62','#c28b55','#7e8bb0','#bc7e8c'];
let requestNumber=0;
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const date=(v,full=false)=>v?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',...(full?{hour:'2-digit',minute:'2-digit'}:{})}).format(new Date(v)):'—';
async function api(route,body,method='POST') {
  const response=await fetch(`/api/index?route=${route}`,body===undefined?{}:{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json();
  if(response.status===401){$('#dashboard').hidden=true;$('#login').hidden=false;}
  if(!response.ok)throw new Error(data.error||'요청을 완료하지 못했습니다.');
  return data;
}
function notify(message){$('#notice').textContent=message;$('#notice').hidden=!message;}
async function load(){
  const serial=++requestNumber;
  $('#refresh').disabled=true;
  try{
    const params=new URLSearchParams({days:state.days,topic:state.topic,saved:state.saved?'1':'0',search:state.search});
    const data=await api(`dashboard&${params}`);
    if(serial!==requestNumber)return;
    state.data=data;state.page=1;
    $('#login').hidden=true;$('#dashboard').hidden=false;
    render();
  }catch(e){if(serial!==requestNumber)return;if($('#dashboard').hidden)$('#login-message').textContent=e.message==='로그인이 필요합니다.'?'':e.message;else notify(e.message);}
  finally{if(serial===requestNumber)$('#refresh').disabled=false;}
}
$('#today').textContent=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric'}).format(new Date());
$('#login-form').addEventListener('submit',async e=>{e.preventDefault();const button=e.currentTarget.querySelector('button');button.disabled=true;$('#login-message').textContent='확인 중…';try{await api('login',{password:$('#password').value});$('#password').value='';await load();}catch(e){$('#login-message').textContent=e.message;}finally{button.disabled=false;}});
$('#logout').onclick=async()=>{try{await api('logout',{});state.data=null;$('#articles').replaceChildren();$('#dashboard').hidden=true;$('#login').hidden=false;$('#login-message').textContent='';}catch(e){notify(e.message);}};
$('#refresh').onclick=load;
$('#topics').onclick=e=>{const b=e.target.closest('button');if(!b)return;state.topic=b.dataset.topic;state.saved=false;load();};
$('#saved').onclick=()=>{state.saved=!state.saved;load();};
$('#filters').onsubmit=e=>{e.preventDefault();state.search=$('#search').value.trim();load();};
$('#days').onchange=e=>{state.days=Number(e.target.value);load();};
$('#clear').onclick=()=>{Object.assign(state,{topic:'',saved:false,days:7,search:''});$('#search').value='';$('#days').value='7';load();};
function keywordSearch(word){$('#search').value=word;state.search=word;load();}
function render(){
  const d=state.data,a=d.articles;
  document.querySelectorAll('#topics button').forEach(b=>b.classList.toggle('active',b.dataset.topic===state.topic&&!state.saved));
  $('#saved').classList.toggle('active',state.saved);
  $('#article-count').textContent=a.length.toLocaleString();
  $('#saved-count').textContent=a.filter(r=>r.saved).length.toLocaleString();
  $('#top-word').textContent=d.keywords[0]?.word||'—';
  const complete=d.runs.find(r=>r.finished_at);
  $('#last-run').textContent=date(complete?.finished_at,true);
  $('#run-state').textContent=complete?({success:'정상 수집 완료',partial:'일부 수집 실패 · 아래 상태 확인',failed:'수집 실패 · 아래 상태 확인'}[complete.status]||complete.status):'GitHub Actions에서 첫 수집을 실행하세요';
  const messages=[];
  if(!a.length)messages.push(d.coverage.total?'현재 조건에 해당하는 기사가 없습니다. 기간이나 필터를 바꿔보세요.':'아직 기사가 없습니다. GitHub Secrets를 입력한 뒤 Actions → Collect news → Run workflow를 실행하세요.');
  if(d.capped)messages.push('조회 범위가 5,000건을 초과해 최신 5,000건만 분석합니다. 기간이나 주제를 좁혀주세요.');
  if(complete&&complete.status!=='success')messages.push('최근 수집에 오류가 있습니다. 페이지 아래 수집 상태를 확인하세요.');
  if(complete&&Date.now()-new Date(complete.finished_at)>12*3600000)messages.push('마지막 수집이 12시간 이상 지났습니다. GitHub Actions 예약 상태를 확인하세요.');
  notify(messages.join(' '));
  const chips=$('#keywords');chips.replaceChildren();
  d.keywords.forEach(k=>{const b=el('button',undefined,'chip');b.append(el('span',k.word),el('small',`${k.count}건`));b.onclick=()=>keywordSearch(k.word);chips.append(b);});
  if(!d.keywords.length)chips.append(el('p','분석할 기사가 없습니다.','empty'));
  const rising=$('#rising');rising.replaceChildren();
  d.rising.forEach(k=>{const b=el('button');b.append(el('span',k.word),el('em',`+${k.change.toFixed(1)}%p`));b.onclick=()=>keywordSearch(k.word);rising.append(b);});
  if(!d.rising.length)rising.append(el('p',d.risingReady?'현재 조건에서 상승 기준에 해당하는 단어가 없습니다.':'수집 이력이 8일 이상 쌓이고 비교 기사가 확보되면 표시합니다.','fine'));
  $('#list-title').textContent=state.saved?'저장한 이야기':state.topic?`${state.topic}, 새로운 이야기`:'오늘의 발견';
  $('#scope-label').textContent=`${state.days===0?'전체 기간':'최근 '+(state.days===1?'24시간':state.days+'일')} · ${a.length.toLocaleString()}건`;
  renderArticles();renderTrend(d.trends);
  const runs=$('#runs');runs.replaceChildren();
  d.runs.forEach(r=>{const item=el('div',`${date(r.started_at,true)} · ${r.status} · ${r.fetched}건 처리`,'run-row');(r.errors||[]).forEach(error=>item.append(el('div',error,'error')));runs.append(item);});
}
function renderArticles(){
  const list=$('#articles');list.replaceChildren();
  const rows=state.data.articles,start=(state.page-1)*15;
  rows.slice(start,start+15).forEach(a=>{
    const item=el('article',undefined,'news-item'),content=el('div'),meta=el('div',undefined,'news-meta');
    a.topics.forEach(t=>meta.append(el('span',t,'tag')));meta.append(el('span',date(a.published_at,true)));
    const h=el('h3'),open=el('button',a.title);open.onclick=()=>detail(a);h.append(open);
    content.append(meta,h,el('p',a.description,'news-description'));
    if(a.note)content.append(el('div','메모가 있는 기사','note-mark'));
    const actions=el('div',undefined,'news-actions'),save=el('button',a.saved?'★':'☆',`bookmark${a.saved?' is-saved':''}`);
    save.setAttribute('aria-label',a.saved?'즐겨찾기 해제':'즐겨찾기 저장');save.setAttribute('aria-pressed',String(a.saved));
    save.onclick=async()=>{save.disabled=true;try{await api('article',{id:a.id,saved:!a.saved},'PATCH');await load();}catch(e){notify(e.message);save.disabled=false;}};
    const link=el('a','원문 보기 ↗');link.href=a.url;link.target='_blank';link.rel='noopener noreferrer';
    actions.append(save,link);item.append(content,actions);list.append(item);
  });
  if(!rows.length)list.append(el('div','기사 수집 후 이곳에 새로운 이야기가 쌓입니다.','empty'));
  const max=Math.max(1,Math.ceil(rows.length/15));$('#page-label').textContent=`${state.page} / ${max}`;$('#prev').disabled=state.page===1;$('#next').disabled=state.page===max;
}
$('#prev').onclick=()=>{state.page--;renderArticles();};$('#next').onclick=()=>{state.page++;renderArticles();};
$('#close-dialog').onclick=()=>$('#article-dialog').close();
function detail(a){
  const box=$('#article-detail');box.replaceChildren();
  box.append(el('span',`${a.topics.join(' · ')} / ${date(a.published_at,true)}`,'eyebrow'),el('h2',a.title),el('p',a.description),el('small','네이버 검색 결과 설명문입니다. 기사 전문은 원문에서 확인하세요.','fine'));
  const label=el('label','함께 쓰는 메모');label.htmlFor='note';
  const note=el('textarea');note.id='note';note.value=a.note;note.maxLength=5000;
  const actions=el('div',undefined,'detail-actions'),save=el('button','메모 저장','primary'),link=el('a','기사 원문 보기 ↗'),message=el('div','','detail-feedback');message.setAttribute('role','status');
  link.href=a.url;link.target='_blank';link.rel='noopener noreferrer';
  save.onclick=async()=>{save.disabled=true;try{await api('article',{id:a.id,note:note.value},'PATCH');a.note=note.value;message.textContent='저장했습니다.';renderArticles();}catch(e){message.textContent=e.message;}finally{save.disabled=false;}};
  actions.append(save,link);box.append(label,note,actions,message);$('#article-dialog').showModal();
}
function renderTrend(batch){
  const chart=$('#trend-chart'),legend=$('#trend-legend'),table=$('#trend-table');chart.replaceChildren();legend.replaceChildren();table.replaceChildren();
  if(!batch?.payload?.results?.length){chart.append(el('div','검색어 트렌드 수집 결과가 아직 없습니다.','empty'));$('#trend-info').textContent='트렌드 API 인증 정보와 수집 실행 결과를 확인하세요.';return;}
  const data=batch.payload,groups=data.results,dates=[...new Set(groups.flatMap(g=>g.data.map(p=>p.period)))].sort();
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 520 210');svg.setAttribute('role','img');svg.setAttribute('aria-label','최근 30일 검색 관심도. 상세 값은 아래 날짜별 표에서 확인할 수 있습니다.');
  const add=(tag,attrs,text)=>{const n=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;svg.append(n);return n;};
  [0,25,50,75,100].forEach(n=>{const y=175-n*1.5;add('line',{x1:32,x2:505,y1:y,y2:y,stroke:'#e8ede7','stroke-dasharray':'3 4'});add('text',{x:2,y:y+4,fill:'#87918b','font-size':10},n);});
  groups.forEach((g,i)=>{
    const map=new Map(g.data.map(p=>[p.period,p.ratio]));let path='',connected=false;
    dates.forEach((d,j)=>{const n=map.get(d);if(n==null){connected=false;return;}const x=32+j/Math.max(1,dates.length-1)*473,y=175-Math.max(0,Math.min(100,n))*1.5;path+=`${connected?'L':'M'}${x},${y} `;connected=true;add('circle',{cx:x,cy:y,r:1.8,fill:colors[i%5]});});
    add('path',{d:path,fill:'none',stroke:colors[i%5],'stroke-width':2});
    const l=el('span'),dot=el('i');dot.style.backgroundColor=colors[i%5];l.append(dot,document.createTextNode(g.title));legend.append(l);
  });
  if(dates.length){add('text',{x:32,y:198,fill:'#87918b','font-size':10},dates[0].slice(5));add('text',{x:470,y:198,fill:'#87918b','font-size':10},dates.at(-1).slice(5));}chart.append(svg);
  $('#trend-info').textContent=`${data.startDate} ~ ${data.endDate} · ${date(batch.fetched_at,true)} 갱신. 동일 요청 내 최대 검색량을 100으로 한 상대 지수이며 실제 검색 횟수가 아닙니다. 위 기사 필터와 별도로 고정 5개 그룹을 비교합니다.`;
  const t=el('table'),head=el('tr');['날짜',...groups.map(g=>g.title)].forEach(x=>head.append(el('th',x)));t.append(head);
  dates.forEach(d=>{const row=el('tr');row.append(el('td',d));groups.forEach(g=>{const n=g.data.find(p=>p.period===d)?.ratio;row.append(el('td',n==null?'—':Number(n).toFixed(1)));});t.append(row);});table.append(t);
}
load();

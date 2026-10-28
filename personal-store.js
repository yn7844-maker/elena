export const PERSONAL_STORAGE_KEY='elena.personal.v1';
const allowedTopics=new Set(['금융','경제','사회','문화','AI','기타']);
function entryFor(value,url) {
  if(!value||typeof value!=='object')return null;
  let link;try{link=new URL(url);}catch{return null;}
  if(!['http:','https:'].includes(link.protocol)||typeof value.title!=='string'||!Number.isFinite(Date.parse(value.published_at)))return null;
  return {
    id:String(value.id??''),url:link.href,
    title:value.title.slice(0,1000),description:String(value.description??'').slice(0,10000),
    published_at:value.published_at,
    topics:Array.isArray(value.topics)?value.topics.filter(t=>allowedTopics.has(t)):[],
    saved:value.saved===true,note:typeof value.note==='string'?value.note.slice(0,5000):'',
    updatedAt:typeof value.updatedAt==='string'?value.updatedAt:''
  };
}
export function createPersonalStore(getStorage=()=>globalThis.localStorage) {
  function read() {
    const text=getStorage().getItem(PERSONAL_STORAGE_KEY);
    if(!text)return Object.create(null);
    const data=JSON.parse(text);
    if(data?.version!==1||!data.entries||typeof data.entries!=='object'||Array.isArray(data.entries))
      throw new Error('개인 저장 데이터 형식을 확인할 수 없습니다.');
    const result=Object.create(null);
    for(const [url,value] of Object.entries(data.entries)){
      const entry=entryFor(value,url);
      if(entry&&(entry.saved||entry.note))result[entry.url]=entry;
    }
    return result;
  }
  function write(article,patch) {
    const entries=read(),url=new URL(article.url).href,old=entries[url];
    const entry=entryFor({...article,saved:patch.saved??old?.saved??false,note:patch.note??old?.note??'',updatedAt:new Date().toISOString()},url);
    if(!entry)throw new Error('기사를 개인 저장할 수 없습니다.');
    if(entry.saved||entry.note)entries[url]=entry;else delete entries[url];
    getStorage().setItem(PERSONAL_STORAGE_KEY,JSON.stringify({version:1,entries}));
    return entries;
  }
  return {read,write};
}

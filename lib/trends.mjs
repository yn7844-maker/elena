const DAY=86400000;
export const TREND_UNITS=Object.freeze(['date','week','month']);
export function trendRequestPlans(now=Date.now()){
  const korea=new Date(new Date(now).getTime()+9*3600000);
  const today=Date.UTC(korea.getUTCFullYear(),korea.getUTCMonth(),korea.getUTCDate());
  const ymd=t=>new Date(t).toISOString().slice(0,10);
  const weekEnd=today-((new Date(today).getUTCDay()+6)%7+1)*DAY;
  const monthStart=Date.UTC(korea.getUTCFullYear(),korea.getUTCMonth(),1);
  return [
    {timeUnit:'date',startDate:ymd(today-30*DAY),endDate:ymd(today-DAY)},
    {timeUnit:'week',startDate:ymd(weekEnd-83*DAY),endDate:ymd(weekEnd)},
    {timeUnit:'month',startDate:ymd(Date.UTC(korea.getUTCFullYear(),korea.getUTCMonth()-12,1)),endDate:ymd(monthStart-DAY)}
  ];
}
export function trendPeriodBounds(date,unit='date'){
  const day=new Date(date+'T00:00:00Z');
  if(!TREND_UNITS.includes(unit)||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==date)return null;
  const start=new Date(date+'T00:00:00+09:00');
  const end=unit==='month'?new Date(Date.UTC(day.getUTCFullYear(),day.getUTCMonth()+1,1)-9*3600000):new Date(start.getTime()+(unit==='week'?7:1)*DAY);
  return {start,end};
}
export async function collectTrends({query,request,keywordGroups,now=Date.now()}){
  const errors=[];let calls=0;
  for(const plan of trendRequestPlans(now)){
    try{
      if(plan.timeUnit!=='date'){
        const {rows}=await query(`SELECT id FROM trend_batches WHERE time_unit=$1 AND payload->>'startDate'=$2 AND payload->>'endDate'=$3 LIMIT 1`,[plan.timeUnit,plan.startDate,plan.endDate]);
        if(rows.length)continue;
      }
      calls++;
      const data=await request({...plan,keywordGroups});
      if(!Array.isArray(data.results)||data.timeUnit!==plan.timeUnit||data.startDate!==plan.startDate||data.endDate!==plan.endDate)throw new Error('트렌드 응답 형식 또는 기간 오류');
      await query('INSERT INTO trend_batches(payload,time_unit) VALUES($1::jsonb,$2)',[JSON.stringify(data),plan.timeUnit]);
    }catch(e){errors.push(`트렌드/${plan.timeUnit}: ${e.message}`);}
  }
  await query("DELETE FROM trend_batches WHERE fetched_at < NOW()-INTERVAL '90 days'");
  return {calls,errors};
}
export async function storedTrends(query,unit='date',batchId=''){
  const {rows:snapshots}=await query(`SELECT id,fetched_at,payload->>'startDate' AS start_date,payload->>'endDate' AS end_date
    FROM trend_batches WHERE time_unit=$1 ORDER BY fetched_at DESC,id DESC LIMIT 750`,[unit]);
  const {rows:[batch]}=await query(`SELECT * FROM trend_batches WHERE time_unit=$1 AND ($2::bigint IS NULL OR id=$2::bigint)
    ORDER BY fetched_at DESC,id DESC LIMIT 1`,[unit,batchId||null]);
  return {unit,batch:batch||null,snapshots};
}

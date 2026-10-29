import {titleStopWords} from './core.mjs';

export function collectionIntervals(runs,archiveStart){
  const floor=Date.parse(archiveStart);
  const ends=[...new Set(runs.filter(r=>['success','partial'].includes(r.status))
    .map(r=>new Date(r.finished_at).getTime()).filter(t=>Number.isFinite(t)&&t>=floor))].sort((a,b)=>b-a).slice(0,3);
  if(!ends.length)return {current:null,previous:null};
  const interval=(start,end)=>({startAt:new Date(start).toISOString(),endAt:new Date(end).toISOString(),includeStart:start===floor});
  return {
    current:interval(ends[1]??floor,ends[0]),
    previous:ends.length>1?interval(ends[2]??floor,ends[1]):null
  };
}

export async function intervalKeywords(query,interval,topic='',search=''){
  if(!interval)return {keywords:[],articleCount:0};
  // Aggregate all articles in the interval in PostgreSQL. The article-list 5,000-row cap does not apply.
  // Distinct id + word prevents repeated words or multiple category matches from multiplying counts.
  const {rows:[result]}=await query(`WITH matching AS MATERIALIZED (
    SELECT a.id,a.title FROM articles a
    WHERE (a.published_at>$1::timestamptz OR ($6::boolean AND a.published_at=$1::timestamptz))
      AND a.published_at<=$2::timestamptz AND a.first_seen<=$2::timestamptz
      AND ($3='' OR EXISTS(SELECT 1 FROM article_queries q WHERE q.article_id=a.id AND q.topic=$3))
      AND ($4='' OR strpos(lower(a.title||' '||a.description),lower($4))>0)
  ), terms AS (
    SELECT DISTINCT a.id,m.parts[1] AS word FROM matching a
    CROSS JOIN LATERAL regexp_matches(a.title,'[가-힣]{2,12}|[A-Za-z]{2,15}','g') AS m(parts)
  ), ranked AS (
    SELECT word,COUNT(*)::int AS count FROM terms WHERE NOT(word=ANY($5::text[]))
    GROUP BY word ORDER BY count DESC,word ASC LIMIT 18
  ) SELECT (SELECT COUNT(*)::int FROM matching) AS article_count,
    COALESCE((SELECT jsonb_agg(r ORDER BY r.count DESC,r.word ASC) FROM ranked r),'[]'::jsonb) AS keywords`,
    [interval.startAt,interval.endAt,topic,search,titleStopWords,interval.includeStart]);
  return {keywords:result?.keywords||[],articleCount:result?.article_count||0};
}

export function compareKeywordLists(current,previous,comparisonReady){
  const before=new Set(previous.map(k=>k.word));
  return current.map(k=>({...k,isNew:comparisonReady&&!before.has(k.word)}));
}

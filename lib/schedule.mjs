// Fixed Korean local times; Asia/Seoul has no daylight-saving changes.
export const COLLECTION_HOURS_KST = Object.freeze([7,8,9,10,11,15,18,21]);
export const LATE_WARNING_MS = 5*60*1000;
export function collectionWindow(now = Date.now()) {
  const instant = new Date(now).getTime();
  if (!Number.isFinite(instant)) throw new TypeError('Invalid collection time');
  const korea = new Date(instant + 9*3600000);
  const hour = korea.getUTCHours();
  const elapsed = korea.getUTCMinutes()*60000 + korea.getUTCSeconds()*1000 + korea.getUTCMilliseconds();
  const hourStart=instant-elapsed;
  let scheduledAt;
  for(let ago=0;ago<24;ago++){
    if(COLLECTION_HOURS_KST.includes((hour-ago+24)%24)){
      scheduledAt=new Date(hourStart-ago*3600000).toISOString();
      break;
    }
  }
  return {
    onTime: COLLECTION_HOURS_KST.includes(hour) && elapsed <= LATE_WARNING_MS,
    koreaTime: korea.toISOString().replace('Z','+09:00'),
    scheduledAt
  };
}

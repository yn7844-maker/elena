// Fixed Korean local times; Asia/Seoul has no daylight-saving changes.
export const COLLECTION_HOURS_KST = Object.freeze([7,8,9,10,11,15,18,21]);
export const MAX_START_DELAY_MS = 5*60*1000;
export function collectionWindow(now = Date.now()) {
  const instant = new Date(now).getTime();
  if (!Number.isFinite(instant)) throw new TypeError('Invalid collection time');
  const korea = new Date(instant + 9*3600000);
  const hour = korea.getUTCHours();
  const elapsed = korea.getUTCMinutes()*60000 + korea.getUTCSeconds()*1000 + korea.getUTCMilliseconds();
  return {
    allowed: COLLECTION_HOURS_KST.includes(hour) && elapsed <= MAX_START_DELAY_MS,
    koreaTime: korea.toISOString().replace('Z','+09:00'),
    scheduledAt: COLLECTION_HOURS_KST.includes(hour) ? new Date(instant-elapsed).toISOString() : null
  };
}

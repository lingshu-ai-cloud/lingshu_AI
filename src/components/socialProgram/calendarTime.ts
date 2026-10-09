/** Frozen timestamps retain an offset; UTC fallback is explicit and never uses browser locale. */
export type CalendarClock = { offsetMinutes: number; timeZone?:string; label: string; source: 'frozen_iana' | 'publication_offset' | 'schedule_offset' | 'utc_fallback' };
export function frozenCalendarClock(candidates:unknown[],timestamp?:string|null,source:CalendarClock['source']='schedule_offset'):CalendarClock {
 for(const candidate of candidates) { if(typeof candidate!=='string'||!candidate.trim())continue; try { new Intl.DateTimeFormat('en',{timeZone:candidate}).format(); return {offsetMinutes:0,timeZone:candidate,label:candidate,source:'frozen_iana'}; } catch {} }
 return calendarClock(timestamp,source);
}
export function calendarClock(timestamp?: string | null, source: CalendarClock['source'] = 'schedule_offset'): CalendarClock {
  const match=timestamp?.match(/(Z|([+-])(\d{2}):(\d{2}))$/);
  if (!match || !Number.isFinite(Date.parse(timestamp!))) return {offsetMinutes:0,label:'UTC（冻结时区未知）',source:'utc_fallback'};
  const offset=match[1]==='Z'?0:(match[2]==='-'?-1:1)*(Number(match[3])*60+Number(match[4]));
  return {offsetMinutes:offset,label:match[1]==='Z'?'UTC':`UTC${match[1]}`,source};
}
export function calendarDateTime(timestamp: string | number, clock: CalendarClock): {date:string;time:string} {
  const value=typeof timestamp==='number'?timestamp:Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)?timestamp:`${timestamp}Z`);
  if(clock.timeZone&&Number.isFinite(value)) { const parts=new Intl.DateTimeFormat('en-CA',{timeZone:clock.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)); const get=(type:string)=>parts.find(part=>part.type===type)?.value; return {date:`${get('year')}-${get('month')}-${get('day')}`,time:`${get('hour')}:${get('minute')}`}; }
  const date=new Date(value+clock.offsetMinutes*60000);
  if(!Number.isFinite(date.getTime())) return {date:'',time:''};
  return {date:`${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}`,time:`${String(date.getUTCHours()).padStart(2,'0')}:${String(date.getUTCMinutes()).padStart(2,'0')}`};
}
export function calendarTimestampLabel(timestamp: string, clock?: CalendarClock): string {
  const frozen=clock??calendarClock(timestamp);
  const parts=calendarDateTime(timestamp,frozen);
  return parts.date?`${parts.date} ${parts.time} · ${frozen.label}`:'时间待核验';
}

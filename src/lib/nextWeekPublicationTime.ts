export interface PublicationTimeChoice{instant:string;offset:string}
const zones=['Asia/Shanghai','America/New_York','Europe/London','UTC'];
export const publicationTimeZones=zones;
function parts(instant:number,timeZone:string){const p=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant));const get=(name:string)=>Number(p.find(x=>x.type===name)?.value);return {year:get('year'),month:get('month'),day:get('day'),hour:get('hour'),minute:get('minute'),second:get('second')};}
/** Enumerates actual UTC instants instead of guessing the host offset or a DST fold. */
export function publicationTimeChoices(date:string,time:string,timeZone:string):PublicationTimeChoice[]{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time))throw Error('请选择完整的发布日期和时间。');
 const [y,m,d]=date.split('-').map(Number),[h,min]=time.split(':').map(Number),wall=Date.UTC(y,m-1,d,h,min),check=new Date(wall);
 if(check.getUTCFullYear()!==y||check.getUTCMonth()!==m-1||check.getUTCDate()!==d||h>23||min>59)throw Error('日期或时间无效。');
 new Intl.DateTimeFormat('en',{timeZone}).format();
 const offsets=new Set<number>();
 // Probe both sides of any nearby transition. Actual instants are validated below.
 for(let hours=-48;hours<=48;hours+=6){const probe=wall+hours*3600000,p=parts(probe,timeZone);offsets.add(Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)-probe);}
 const choices:PublicationTimeChoice[]=[];
 for(const offsetMs of offsets){if(offsetMs%60000!==0)continue;const instant=wall-offsetMs,p=parts(instant,timeZone);if(p.year!==y||p.month!==m||p.day!==d||p.hour!==h||p.minute!==min||p.second!==0)continue;const minutes=offsetMs/60000,abs=Math.abs(minutes),offset=`${minutes<0?'-':'+'}${String(Math.floor(abs/60)).padStart(2,'0')}:${String(abs%60).padStart(2,'0')}`;choices.push({instant:`${date}T${time}:00${offset}`,offset});}
 return choices.sort((a,b)=>Date.parse(a.instant)-Date.parse(b.instant));
}
export function resolvePublicationTime(date:string,time:string,timeZone:string,chosenOffset?:string){const choices=publicationTimeChoices(date,time,timeZone);if(!choices.length)throw Error('该时间因夏令时跳转不存在，请调整时间。');if(choices.length>1&&!chosenOffset)throw Error('该时间出现两次，请明确选择夏令时或标准时。');const selected=chosenOffset?choices.find(c=>c.offset===chosenOffset):choices[0];if(!selected)throw Error('时区偏移已变化，请重新选择发布时间。');return selected.instant;}

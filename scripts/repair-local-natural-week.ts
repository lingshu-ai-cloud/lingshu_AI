import assert from 'node:assert/strict';
import {naturalWeek,businessDate} from '../shared/naturalWeek.js';
const root='http://127.0.0.1:5177/api/overseas',programId='7f9242c2-bdeb-40ea-ae59-6c2adbc96fad',packageId='39eedb9f-30c3-46bb-b5f3-3922a006644d';
const {token}=await fetch(`${root}/auth/local-preview-session`,{method:'POST',headers:{Origin:'http://127.0.0.1:5177'}}).then(r=>r.json());
async function request(path:string,method='GET',body?:unknown){const response=await fetch(`${root}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});const value=await response.json();if(!response.ok)throw Error(JSON.stringify({status:response.status,code:value.code,message:value.message??value.error}));return value;}
const base=`/social-programs/${programId}/operating-packages/${packageId}`,source=(await request(base)).item;
const target=naturalWeek('2026-10-15');
if(source.weekStart===target.start&&source.weekEnd===target.end){console.log(JSON.stringify({alreadyRepaired:true,version:source.version,start:source.weekStart,end:source.weekEnd}));process.exit(0);}
assert.equal(source.version,2);assert.equal(source.status,'draft');assert.equal(source.weekStart,'2026-10-14');assert.equal(source.weekEnd,'2026-10-20');assert.equal(source.socialContentPackage.authorization.allowRealPublishing,false);
const tasks=(await request(`${base}/execution-tasks?version=2`)).items;
assert.ok(tasks.length);assert.ok(tasks.every(t=>t.status==='pending_activation'&&!t.lease&&t.attempt===0&&!t.resultRefs.length&&!t.schedule.actualStartedAt&&!t.schedule.actualFinishedAt&&!t.productionProgress),'only an entirely unexecuted draft can be rebased');
const originals=source.socialContentPackage.publicationTasks;
const publications=originals.map(p=>{
 assert.equal(p.status,'planned');assert.ok(/^\d{4}-\d{2}-\d{2}T.*[+-]\d{2}:\d{2}$/.test(p.publishWindow));
 const oldDate=businessDate(p.publishWindow),weekday=(new Date(`${oldDate}T12:00:00Z`).getUTCDay()+6)%7,date=new Date(`${target.start}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+weekday);const day=date.toISOString().slice(0,10);
 return{...p,publishWindow:day+p.publishWindow.slice(10),motherContentId:p.motherContentId===`daily-${oldDate}`?`daily-${day}`:p.motherContentId};
});
assert.deepEqual(publications.map(p=>p.publicationTaskId),originals.map(p=>p.publicationTaskId));assert.equal(publications.length,16);
const input={expectedVersion:2,changeReason:'修正滚动周为自然周；仅重排原16条未执行计划，保留原版本，不生成历史执行或交付记录',weekStart:target.start,publicationTasks:publications,capacityNotes:[...(source.socialContentPackage.capacityNotes??[]),'自然周纠错：原10/19、10/20的未执行计划按同一星期归属校正为10/12、10/13；旧v2保留。过往日期为本次修订的未执行计划，不是历史完成记录。']};
const result=(await request(base,'PUT',input)).item;
assert.equal(result.version,3);assert.equal(result.weekStart,target.start);assert.equal(result.weekEnd,target.end);assert.equal(result.status,'draft');
assert.deepEqual(result.socialContentPackage.publicationTasks.map(p=>p.publicationTaskId).sort(),originals.map(p=>p.publicationTaskId).sort());
const actual=(await request(`${base}/execution-tasks?version=3`)).items;
assert.ok(actual.every(t=>t.status==='pending_activation'&&!t.resultRefs.length&&!t.schedule.actualStartedAt));
console.log(JSON.stringify({version:result.version,weekStart:result.weekStart,weekEnd:result.weekEnd,publicationCount:publications.length,taskCount:actual.length,publicationDates:result.socialContentPackage.publicationTasks.reduce((counts,p)=>{const day=businessDate(p.publishWindow);counts[day]=(counts[day]??0)+1;return counts;},{}),taskAssignedDates:actual.reduce((counts,t)=>{const day=t.inputSnapshot.calendarAssignmentDate;counts[day]=(counts[day]??0)+1;return counts;},{}),allUnexecuted:true,oldVersionPreserved:true}));

import test from 'node:test';
import assert from 'node:assert/strict';
import type { WeeklyExecutionTask } from '../../../shared/contracts/socialProgram';
import type { WeeklyMaterialRequest } from '../../../server/socialPrograms/weeklyMaterialRequests';
import { isHumanTaskOverdue } from '../smartBusiness/AgentWeeklyCalendar';
import { isMaterialCalendarTask, materialReferenceIsOverdue, projectWeeklyMaterialCalendar, type WeeklyMaterialCalendarScope } from './weeklyMaterialCalendarProjection';
const scope:WeeklyMaterialCalendarScope={tenantId:'tenant',programId:'program',packageId:'week',packageVersion:1,weekStart:'2026-10-05',weekEnd:'2026-10-11'};
const tasks=[{tenantId:'tenant',programId:'program',packageId:'week',packageVersion:1,taskId:'consumer',publicationTaskId:'video',scope:'content',schedule:{stepKind:'material_readiness'}}] as WeeklyExecutionTask[];
const request:WeeklyMaterialRequest={requestId:'real-request',tenantId:'tenant',programId:'program',requirementKey:'产品细节镜头',requirements:'提供真实产品规格与包装镜头',assigneeUserId:'uploader',reviewerUserId:'reviewer',dueAt:'2026-10-06T10:00:00+08:00',verificationDueAt:'2026-10-06T16:00:00+08:00',timeZone:'Asia/Shanghai',status:'missing',consumers:[{taskId:'consumer',packageId:'week',packageVersion:1,requirement:'核验规格细节'}],submissions:[],history:[],createdAt:'2026-10-05T08:00:00+08:00',updatedAt:'2026-10-05T08:00:00+08:00'};
const pending=():WeeklyMaterialRequest=>({...request,status:'pending_verification',submissions:[{version:1,submittedAt:'2026-10-06T09:00:00+08:00',submittedBy:'uploader',materials:[{recordId:'real-material',sha256:'a'.repeat(64),type:'video',byteSize:100}],verification:null}]});
function reviewed(accepted=true):WeeklyMaterialRequest {const value=pending();value.status=accepted?'accepted':'rejected';value.submissions[0]!.verification={reviewedAt:'2026-10-06T15:00:00+08:00',reviewedBy:'reviewer',decision:accepted?'accepted':'rejected',consumerDecisions:[{taskId:'consumer',accepted,factCheck:'已核验真实规格',rightsCheck:'产品镜头已授权',visualCheck:'可用于对应镜头'}]};return value;}
test('upload and verification are distinct genuine deadline/owner tasks with real material identity',()=>{
 const value=projectWeeklyMaterialCalendar([request],scope,tasks);assert.equal(value.tasks.length,2);
 const [upload,verification]=value.tasks;assert.equal(upload!.assignee,'uploader');assert.equal(verification!.assignee,'reviewer');
 assert.equal(upload!.dueAt,request.dueAt);assert.equal(verification!.dueAt,request.verificationDueAt);assert.equal(upload!.minutes,null);
 assert.equal(upload!.materialAction,'upload');assert.equal(verification!.materialAction,'verification');assert.equal(upload!.productionTaskId,undefined);assert.ok(isMaterialCalendarTask(upload!));
 assert.deepEqual(upload!.affectedPublicationIds,['video']);assert.deepEqual(verification!.affectedPublicationIds,['video']);
 assert.equal(isHumanTaskOverdue(upload!,Date.parse(request.dueAt)+1),true);assert.equal(isHumanTaskOverdue(verification!,Date.parse(request.verificationDueAt!)+1),false);
});
test('pending upload is never overdue while available verification has its own overdue deadline',()=>{
 const [upload,verification]=projectWeeklyMaterialCalendar([pending()],scope,tasks).tasks;
 assert.equal(upload!.submission,'pending');assert.equal(isHumanTaskOverdue(upload!,Date.parse(request.dueAt)+999999),false);
 assert.equal(verification!.humanAction,'approval');assert.equal(isHumanTaskOverdue(verification!,Date.parse(request.verificationDueAt!)+1),true);
});
test('missing or invalid verification deadline stays unscheduled and never inherits upload cutoff',()=>{
 for(const verificationDueAt of [null,'invalid','2026-10-06T16:00:00']){const value=projectWeeklyMaterialCalendar([{...pending(),verificationDueAt}],scope,tasks);assert.equal(value.tasks.length,1);assert.equal(value.unscheduledVerification.length,1);assert.equal(value.unscheduledVerification[0]!.assigneeUserId,'reviewer');}
});
test('rejection reopens upload work; completed review is not mislabelled successful asset acceptance',()=>{
 const [upload,verification]=projectWeeklyMaterialCalendar([reviewed(false)],scope,tasks).tasks;assert.equal(upload!.status,'blocked');assert.equal(upload!.submission,'rejected');assert.equal(isHumanTaskOverdue(upload!,Date.parse(request.dueAt)+1),true);
 assert.equal(verification!.status,'completed');assert.match(verification!.output,/通过 0\/1/);
 const passed=projectWeeklyMaterialCalendar([reviewed()],scope,tasks).tasks;assert.ok(passed.every(task=>task.status==='completed'));assert.ok(passed.every(task=>!isHumanTaskOverdue(task,Date.parse(request.verificationDueAt!)+1)));
});
test('exact tenant/program/week/version and actual consumer task constrain visibility',()=>{
 for(const changes of [{tenantId:'other'},{programId:'other'},{consumers:[{...request.consumers[0]!,packageVersion:2}]},{consumers:[{...request.consumers[0]!,packageId:'other'}]},{consumers:[{...request.consumers[0]!,taskId:'invented'}]}])assert.equal(projectWeeklyMaterialCalendar([{...request,...changes}],scope,tasks).tasks.length,0);
 const foreignTasks=[{...tasks[0]!,tenantId:'other'}];assert.equal(projectWeeklyMaterialCalendar([request],scope,foreignTasks).tasks.length,0);
});
test('shared physical requests deduplicate cards and cross-week consumers reference instead of repeating work',()=>{
 const shared={...request,consumers:[...request.consumers,{taskId:'next-consumer',packageId:'next-week',packageVersion:1,requirement:'同一批产品镜头'}]};
 const current=projectWeeklyMaterialCalendar([shared,structuredClone(shared)],scope,tasks);assert.equal(current.tasks.length,2);assert.equal(new Set(current.tasks.map(task=>task.id)).size,2);
 const futureScope={...scope,packageId:'next-week',weekStart:'2026-10-12',weekEnd:'2026-10-18'};const futureTasks=[{...tasks[0]!,packageId:'next-week',taskId:'next-consumer'}];
 const next=projectWeeklyMaterialCalendar([shared],futureScope,futureTasks);assert.equal(next.tasks.length,0);assert.equal(next.sharedReferences.length,2);assert.ok(next.sharedReferences.every(ref=>ref.requestId===request.requestId));
 assert.ok(next.sharedReferences.every(ref=>JSON.stringify(ref.affectedPublicationIds)===JSON.stringify(['video'])));
});
test('pre-week upload is referenced but genuine current-week verification remains a single dated task',()=>{
 const value=projectWeeklyMaterialCalendar([{...request,dueAt:'2026-10-04T18:00:00+08:00'}],scope,tasks);assert.equal(value.tasks.length,1);assert.equal(value.tasks[0]!.materialAction,'verification');assert.equal(value.sharedReferences.length,1);assert.equal(value.sharedReferences[0]!.action,'upload');assert.equal(materialReferenceIsOverdue(value.sharedReferences[0]!,Date.parse(request.dueAt)+1),true);
});
test('material deadlines use their frozen timezone at week boundaries regardless of viewer timezone',()=>{
 const value=projectWeeklyMaterialCalendar([{...request,timeZone:'America/Los_Angeles',dueAt:'2026-10-05T06:30:00Z',verificationDueAt:'2026-10-05T08:30:00Z'}],scope,tasks);
 assert.equal(value.sharedReferences.length,1);
 assert.equal(value.sharedReferences[0]!.action,'upload');
 assert.equal(value.tasks.length,1);
 assert.equal(value.tasks[0]!.date,'2026-10-05');
 assert.equal(value.tasks[0]!.time,'01:30');
 assert.equal(value.tasks[0]!.calendarClock?.timeZone,'America/Los_Angeles');
 const fallback=projectWeeklyMaterialCalendar([{...request,timeZone:'',dueAt:'2026-10-05T00:30:00+08:00'}],scope,tasks);
 assert.equal(fallback.tasks.find(card=>card.materialAction==='upload')!.date,'2026-10-05');
 assert.equal(fallback.tasks.find(card=>card.materialAction==='upload')!.time,'00:30');
});
test('cancelled requests never become overdue and conflicting or unsupported completion proof fails closed',()=>{
 const cancelled=projectWeeklyMaterialCalendar([{...request,status:'cancelled'}],scope,tasks);assert.ok(cancelled.tasks.every(task=>task.status==='cancelled'&&!isHumanTaskOverdue(task,Date.parse(request.verificationDueAt!)+1)));
 const conflict=projectWeeklyMaterialCalendar([request,{...request,requirements:'冲突镜头'}],scope,tasks);assert.equal(conflict.tasks.length,0);assert.equal(conflict.issues.length,1);
 const fabricated=projectWeeklyMaterialCalendar([{...request,status:'accepted'}],scope,tasks);assert.equal(fabricated.tasks.length,0);assert.equal(fabricated.issues.length,1);
 const invalid=projectWeeklyMaterialCalendar([{...request,dueAt:'2026-02-30T10:00:00+08:00'}],scope,tasks);assert.equal(invalid.tasks.length,0);assert.equal(invalid.issues.length,1);
});

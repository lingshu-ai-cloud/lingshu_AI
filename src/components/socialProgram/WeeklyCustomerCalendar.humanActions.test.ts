import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import type {WeeklySalesHandoff} from '../../../shared/contracts/socialWeeklySalesHandoff';
import type {AgentCalendarTask} from '../smartBusiness/AgentWeeklyCalendar';
import {forwardCalendarSales,forwardCalendarMaterial} from './WeeklyCustomerCalendar';
import {projectWeeklySalesCalendar} from './weeklySalesCalendarProjection';
const scope={tenantId:'tenant',programId:'program',packageId:'week',packageVersion:1,weekStart:'2026-10-05',weekEnd:'2026-10-11'};
const salesScope={tenantId:scope.tenantId,programId:scope.programId,packageId:scope.packageId,packageVersion:scope.packageVersion};
const handoff:WeeklySalesHandoff={id:'handoff',...scope,runId:'run',memberId:'member',customerId:'customer',sourceInteractionId:'inquiry',sourceKind:'new_inquiry',sourceEvidence:{interactionId:'inquiry',body:'Buyer inquiry',timestamp:1},ownerUserId:'sales',createdBy:'owner',claimDueAt:'2026-10-06T12:00:00Z',feedbackDueAt:'2026-10-08T12:00:00Z',approvedBatchId:'batch',approvedBatchVersion:1,approvedContentHash:'hash',status:'awaiting_claim',version:1,claimedAt:null,feedback:null};
test('calendar click forwards the exact current sales action once',()=>{const card=projectWeeklySalesCalendar([handoff],scope).tasks[0]!;const opened:AgentCalendarTask[]=[];forwardCalendarSales(card,salesScope,[handoff],value=>opened.push(value));assert.deepEqual(opened,[card]);});
test('sales calendar click refuses stale, cross tenant, malformed or ambiguous records before opening',()=>{
 const card=projectWeeklySalesCalendar([handoff],scope).tasks[0]!;let calls=0;const open=()=>{calls++;};
 for(const field of ['tenantId','programId','packageId','runId','memberId','customerId','handoffId','action'] as const){const altered={...card,salesTarget:{...card.salesTarget!,[field]:'foreign'}} as AgentCalendarTask;assert.throws(()=>forwardCalendarSales(altered,salesScope,[handoff],open));}
 for(const records of [[],[handoff,handoff],[{...handoff,version:2}],[{...handoff,memberId:'foreign'}],[{...handoff,customerId:'foreign'}]])assert.throws(()=>forwardCalendarSales(card,salesScope,records,open));
 assert.throws(()=>forwardCalendarSales(card,{...salesScope,packageVersion:2},[handoff],open));
 assert.throws(()=>forwardCalendarSales({...card,salesTarget:undefined},salesScope,[handoff],open));
 assert.throws(()=>forwardCalendarSales(card,salesScope,[handoff]));assert.equal(calls,0);
});
test('real calendar and connected panel clicks reuse guarded sales dispatch and reveal',()=>{const calendar=readFileSync(new URL('./WeeklyCustomerCalendar.tsx',import.meta.url),'utf8');const connected=readFileSync(new URL('../smartBusiness/ConnectedAgentCalendar.tsx',import.meta.url),'utf8');assert.match(calendar,/forwardCalendarSales\(task,recoveryScope/);assert.match(connected,/revealWeeklySalesAction\(/);});

import type {WeeklyExecutionTask} from '../../../shared/contracts/socialProgram';
import type {WeeklyMaterialRequest} from '../../../server/socialPrograms/weeklyMaterialRequests';
import {projectWeeklyMaterialCalendar} from './weeklyMaterialCalendarProjection';
const consumers=[{tenantId:'tenant',programId:'program',packageId:'week',packageVersion:1,taskId:'consumer',publicationTaskId:'video',scope:'content',schedule:{stepKind:'material_readiness'}}] as WeeklyExecutionTask[];
const request:WeeklyMaterialRequest={requestId:'request',tenantId:'tenant',programId:'program',requirementKey:'产品镜头',requirements:'真实规格镜头',assigneeUserId:'uploader',reviewerUserId:'reviewer',dueAt:'2026-10-06T10:00:00+08:00',verificationDueAt:'2026-10-06T16:00:00+08:00',timeZone:'Asia/Shanghai',status:'missing',consumers:[{taskId:'consumer',packageId:'week',packageVersion:1,requirement:'规格'}],submissions:[],history:[],createdAt:'2026-10-05T08:00:00+08:00',updatedAt:'2026-10-05T08:00:00+08:00'};
test('material clicks forward distinct upload and verification actions to one physical request',()=>{const calls:unknown[]=[];for(const card of projectWeeklyMaterialCalendar([request],scope,consumers).tasks)forwardCalendarMaterial(card,scope,[request],consumers,(id,action)=>calls.push([id,action]));assert.deepEqual(calls,[['request','upload'],['request','verification']]);});
test('material clicks fail closed for stale scope, missing consumers, malformed actions and submission versions',()=>{
 const card=projectWeeklyMaterialCalendar([request],scope,consumers).tasks[0]!;let calls=0;const open=()=>{calls++;};
 for(const alteredScope of [{...scope,tenantId:'foreign'},{...scope,programId:'foreign'},{...scope,packageId:'foreign'},{...scope,packageVersion:2}])assert.throws(()=>forwardCalendarMaterial(card,alteredScope,[request],consumers,open));
 for(const changed of [{...card,materialAction:'invented'},{...card,materialAction:'verification'},{...card,materialConsumerTaskIds:['invented']},{...card,materialSubmissionVersion:99},{...card,assignee:'foreign'},{...card,id:'invented'}] as AgentCalendarTask[])assert.throws(()=>forwardCalendarMaterial(changed,scope,[request],consumers,open));
 for(const requests of [[],[{...request,tenantId:'foreign'}],[request,{...request,requirements:'conflict'}]])assert.throws(()=>forwardCalendarMaterial(card,scope,requests,consumers,open));
 assert.throws(()=>forwardCalendarMaterial(card,scope,[request],[],open));assert.throws(()=>forwardCalendarMaterial(card,scope,[request],consumers));assert.equal(calls,0);
});
test('material real calendar click uses guarded dispatcher and connected panel retains action',()=>{const calendar=readFileSync(new URL('./WeeklyCustomerCalendar.tsx',import.meta.url),'utf8');const connected=readFileSync(new URL('../smartBusiness/ConnectedAgentCalendar.tsx',import.meta.url),'utf8');assert.match(calendar,/forwardCalendarMaterial\(task,/);assert.match(connected,/openMaterialPanelRequest\([^;]*action\)/);});

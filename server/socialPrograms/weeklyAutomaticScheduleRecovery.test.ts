import test from 'node:test';
import assert from 'node:assert/strict';
import type {DataStore,Record_} from '../storage/datastore.js';
import {recoverCommittedAutomaticWeeklySchedule,AUTOMATIC_WEEKLY_SCHEDULES} from './weeklyAutomaticSchedule.js';
import {SCHEDULE_PROPOSALS,scheduleHash} from './weeklyScheduleSnapshots.js';

function fixture(){
 const scope={tenantId:'tenant',programId:'program',packageId:'package',packageVersion:6,actorUserId:'owner'};
 const proposal:any={tenantId:'tenant',programId:'program',packageId:'package',packageVersion:6,createdBy:'owner',proposalId:'proposal',inputAuthority:'target_graph_with_automatic_template_capacity',automaticAdoption:{source:'automatic_template',templateVersion:'weekly-automation.v3',adoptedAt:'2026-10-18T00:00:00Z',userApproval:null},plan:{assignments:[],publicationGap:0}};
 const item:any={packageId:'package',programId:'program',version:7,previousVersion:6,status:'draft',scheduleRevisionRef:{type:'weekly_schedule_snapshot',id:'snapshot',version:1}};
 const confirmation:any={status:'committed',sourceVersion:6,targetVersion:7,item,snapshot:{snapshotId:'snapshot',confirmedBy:'owner',automaticAdoption:proposal.automaticAdoption}};
 const rows:Record_[]=[{id:'v7',collection:'social_weekly_operating_packages',tenant_id:'tenant',program_id:'program',package_id:'package',version:7,payload:item},{id:'proposal-row',collection:SCHEDULE_PROPOSALS,tenant_id:'tenant',program_id:'program',package_id:'package',package_version:6,proposal_id:'proposal',payload:proposal,content_hash:scheduleHash(proposal)}];
 let writes=0;
 const store={async list(collection:string,query:any={}){let matches=rows.filter(row=>row.collection===collection&&Object.entries(query.where??{}).every(([k,v])=>row[k]===v));if(query.sort==='-version')matches=matches.sort((a,b)=>Number(b.version)-Number(a.version));const page=query.page??1,perPage=query.perPage??30;return{items:structuredClone(matches.slice((page-1)*perPage,page*perPage)),totalItems:matches.length,totalPages:Math.max(1,Math.ceil(matches.length/perPage)),page,perPage};},async getById(collection:string,id:string){return structuredClone(rows.find(row=>row.collection===collection&&row.id===id)??null);},async create(collection:string,data:Record<string,unknown>){writes++;const row={...structuredClone(data),collection} as unknown as Record_;rows.push(row);return structuredClone(row);}} as DataStore;
 return {scope,rows,store,confirmation,writes:()=>writes};
}

test('restart repairs only committed automatic target, once, without another confirmation',async()=>{
 const f=fixture(),readConfirmation=async()=>f.confirmation;
 const first=await recoverCommittedAutomaticWeeklySchedule(f.store,f.scope,{readConfirmation});
 assert.equal(first?.status,'scheduled');assert.equal(first?.targetVersion,7);assert.equal(first?.userApproval,null);assert.equal(first?.outboundAuthorization,false);
 assert.equal(f.writes(),1);assert.equal(f.rows.filter(row=>row.collection===AUTOMATIC_WEEKLY_SCHEDULES).length,1);
 const restarted=await recoverCommittedAutomaticWeeklySchedule(f.store,f.scope,{readConfirmation});
 assert.deepEqual(restarted,first);assert.equal(f.writes(),1);
});

test('wrong target snapshot fails closed and writes no admission receipt',async()=>{
 const f=fixture();f.confirmation.snapshot.snapshotId='different';
 await assert.rejects(recoverCommittedAutomaticWeeklySchedule(f.store,f.scope,{readConfirmation:async()=>f.confirmation}),{code:'weekly_template_schedule_recovery_target_invalid'});
 assert.equal(f.writes(),0);
});

test('proposal identity drift cannot manufacture a recovered automatic receipt',async()=>{
 const f=fixture(),row=f.rows.find(value=>value.collection===SCHEDULE_PROPOSALS)!;
 (row.payload as any).createdBy='other-user';row.content_hash=scheduleHash(row.payload);
 await assert.rejects(recoverCommittedAutomaticWeeklySchedule(f.store,f.scope,{readConfirmation:async()=>f.confirmation}),{code:'weekly_template_schedule_proposal_invalid'});
 assert.equal(f.writes(),0);
});

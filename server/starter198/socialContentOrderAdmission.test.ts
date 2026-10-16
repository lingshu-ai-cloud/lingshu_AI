import test from 'node:test';
import assert from 'node:assert/strict';
import {initialSocialContentOrder,reserveSocialContentOrder} from './socialContentOrderAdmission.js';
import {CONTENT_CREATION_QUOTA_COLLECTION,createContentCreationQuotaService} from '../socialPrograms/contentCreationQuota.js';
function fixture(){
 const tables=new Map<string,Map<string,any>>();const table=(name:string)=>{if(!tables.has(name))tables.set(name,new Map());return tables.get(name)!;};
 table('social_programs').set('p',{id:'p',tenant_id:'tenant',program_id:'program'});
 const store:any={supportsAtomicCompareAndSwap:()=>true,getById:async(c:string,id:string)=>structuredClone(table(c).get(id)??null),
 create:async(c:string,v:any)=>{if(table(c).has(v.id))return null;table(c).set(v.id,structuredClone(v));return structuredClone(v);},
 compareAndSwap:async(c:string,id:string,expected:any,patch:any)=>{const row=table(c).get(id);if(!row||Object.keys(expected).some(k=>JSON.stringify(row[k])!==JSON.stringify(expected[k])))return false;table(c).set(id,structuredClone({...row,...patch}));return true;},
 list:async(c:string,q:any)=>{const rows=[...table(c).values()].filter(r=>Object.entries(q.where??{}).every(([k,v])=>r[k]===v));return{items:structuredClone(rows.slice(0,q.perPage)),totalItems:rows.length};}};
 const task=(id:string,entry:'workspace'|'assistant'|'weekly_package'='workspace')=>{const row={id,task_id:id,tenant_id:'tenant',content_order:initialSocialContentOrder(id,entry),brief:{}};table('starter_social_content_tasks').set(id,row);return structuredClone(row);};
 const repository:any={dataStore:store,list:(c:string,t:string,q:any)=>store.list(c,{...q,where:{tenant_id:t,...q?.where}}),get:(c:string,_t:string,id:string)=>store.getById(c,id)};
 const start=(row:any,commandId:string,now=new Date('2026-10-16T03:00:00Z'))=>reserveSocialContentOrder({repository,tenantId:'tenant',userId:'user',task:row,commandId,now});
 return{store,table,task,start,pools:()=>[...table(CONTENT_CREATION_QUOTA_COLLECTION).values()]};
}
test('completed root group fence rejects original or same-task revision admission without another outbox',async()=>{
 const f=fixture(),row:any=f.task('root');await f.start(row,'first');
 const fresh=f.table('starter_social_content_tasks').get('root');fresh.status='completed';fresh.content_order.cancellation={operationId:'group-cancel'};
 const before=structuredClone(f.pools());
 await assert.rejects(f.start(structuredClone(fresh),'new-start'),/original_cancelled_or_replaced/);
 assert.deepEqual(f.pools(),before);assert.equal(fresh.status,'completed');
});
test('draft metadata does not consume quota; all new entry types share five slots at actual start',async()=>{
 const f=fixture(),rows=Array.from({length:6},(_,i)=>f.task(`c${i}`,i%2?'assistant':'workspace'));
 assert.equal(f.pools().length,0);
 for(let i=0;i<5;i++)await f.start(rows[i],`cmd${i}`);
 await assert.rejects(f.start(rows[5],'cmd5'),/quota_full/);
 assert.equal(f.pools()[0].payload.outbox.length,5);
});
test('origin week and production identity survive next-week retry without another allowance',async()=>{
 const f=fixture(),r=f.task('c');const first=(await f.start(r,'first'))!;await first.acknowledge();
 const persisted=structuredClone(f.table('starter_social_content_tasks').get('c'));
 const resumed=(await f.start(persisted,'retry',new Date('2026-10-19T02:00:00Z')))!;
 await resumed.acknowledge();assert.equal(resumed.binding.originWeek,'2026-10-12');
 assert.equal(resumed.dispatchCommandId,'first');assert.equal(f.pools().length,1);
 assert.equal(f.pools()[0].payload.outbox.length,1);
});
test('a committed replacement plan recovers its original week before task binding instead of minting a new allowance',async()=>{
 const f=fixture(),row=f.task('unbound-replacement');
 f.table('social_programs').set('other',{id:'other',tenant_id:'tenant',program_id:'other-program'});
 const quota=createContentCreationQuotaService({store:f.store,assertAtomicStore:async()=>{},readReleaseSafety:async()=>({leaseActive:false,inFlight:false,paid:false,unknown:false}),verifyDelivery:async()=>false});
 const scope={tenantId:'tenant',programId:'program',weekStart:'2026-10-12'};
 await quota.plan(scope,{commandId:'committed-plan',actorId:'owner',reason:'replacement committed before projection'},{contentId:row.task_id,entry:'workspace'});
 const result=await f.start(row,'start-after-recovery',new Date('2026-10-19T12:00:00+08:00'));
 assert.equal(result?.scope.weekStart,'2026-10-12');assert.equal(result?.scope.programId,'program');
 assert.equal(f.pools().length,1);assert.equal(result?.order.state,'reserved');assert.equal(f.pools()[0].payload.slots.filter((s:any)=>s.contentId).length,1);
});
test('missing program, non-atomic backend and forged content or revision do not enqueue or reserve',async()=>{
 const f=fixture();f.table('social_programs').clear();await assert.rejects(f.start(f.task('none'),'none'),/program_selection_required/);
 f.table('social_programs').set('p',{id:'p',tenant_id:'tenant',program_id:'program'});
 const forged=f.task('forged');forged.content_order.budgetTaskId='new-budget';await assert.rejects(f.start(forged,'forged'),/identity_invalid/);
 const revision:any=f.task('revision');revision.brief={_productionRevision:{parentTaskId:'parent'}};Object.assign(f.table('starter_social_content_tasks').get('revision'),revision);await assert.rejects(f.start(revision,'revision'),/cost_lineage_revision_invalid/);
 f.store.supportsAtomicCompareAndSwap=()=>false;await assert.rejects(f.start(f.task('unsafe'),'unsafe'),/atomic_store_required/);
 assert.equal(f.pools().length,0);
});
test('legacy rows are not silently assigned a fresh quota or rewritten identity',async()=>{
 const f=fixture();assert.equal(await f.start({id:'legacy',task_id:'legacy',brief:{}},'legacy'),null);assert.equal(f.pools().length,0);
});
test('new publication-scoped weekly and revision orders cannot mint independent content allowances before migration',async()=>{
 const f=fixture(),row:any=f.task('weekly','weekly_package');row.brief={_weeklyAuthority:{weeklyPackage:{programId:'program',packageId:'p',version:1}}};
 await assert.rejects(f.start(row,'weekly'),/weekly_shared_original_authority_required/);
 assert.equal(f.pools().length,0);
});
test('four frozen distributions reserve one original through actual OrderAdmission and preserve its natural week',async()=>{
 const f=fixture(),canonical={publicationTaskId:'publication',motherContentId:'mother',adaptationOfPublicationTaskId:null,platform:'tiktok',accountId:'tiktok-account',businessProposition:'Verified product fact',cta:'Contact WhatsApp for a free sample',factRefs:[{type:'enterprise_fact',id:'fact',version:1}],status:'planned'};
 const publications=[canonical,...['facebook','instagram','youtube'].map(platform=>({...canonical,publicationTaskId:platform,platform,accountId:`${platform}-account`,adaptationOfPublicationTaskId:'publication'}))];
 const pkg:any={programId:'program',packageId:'week',version:1,status:'draft',weekStart:'2026-10-12',weekEnd:'2026-10-18',socialContentPackage:{productionIdentityVersion:'shared-original.v1',publicationTasks:publications}};
 const row:any=f.task('shared-content','weekly_package');row.create_idempotency_key='weekly-production:week:1:publication';row.brief={programRef:{id:'program'},_weeklyAuthority:{weeklyPackage:structuredClone(pkg),publicationTask:structuredClone(canonical),programRef:{id:'program'}}};f.table('starter_social_content_tasks').set(row.id,structuredClone(row));
 // Publication status may advance without changing immutable business authority.
 pkg.socialContentPackage.publicationTasks[0].status='ready';f.table('social_weekly_operating_packages').set('week',{id:'week',tenant_id:'tenant',program_id:'program',package_id:'week',version:1,payload:pkg});
 const first=await f.start(row,'shared-first');assert.equal(first?.scope.weekStart,'2026-10-12');assert.equal(first?.order.packageId,'week');assert.equal(first?.order.contentId,'shared-content');
 const fresh=structuredClone(f.table('starter_social_content_tasks').get(row.id)),retry=await f.start(fresh,'shared-retry',new Date('2026-10-19T03:00:00Z'));assert.equal(retry?.binding.originWeek,'2026-10-12');assert.equal(retry?.dispatchCommandId,'shared-first');
 for(const publication of publications.slice(1)){const alias:any=f.task(`alias-${publication.publicationTaskId}`,'weekly_package');alias.create_idempotency_key=`weekly-production:week:1:${publication.publicationTaskId}`;alias.brief={programRef:{id:'program'},_weeklyAuthority:{weeklyPackage:pkg,publicationTask:publication,programRef:{id:'program'}}};f.table('starter_social_content_tasks').set(alias.id,structuredClone(alias));await assert.rejects(f.start(alias,`alias-${publication.publicationTaskId}`),/weekly_shared_original_identity_invalid/);}
 const pool=f.pools()[0].payload;assert.equal(f.pools().length,1);assert.equal(Object.keys(pool.orders).length,1);assert.equal(pool.outbox.length,1);assert.equal(f.table('starter_social_content_tasks').get(row.id).create_idempotency_key,'weekly-production:week:1:publication');
 const changed=structuredClone(fresh);changed.brief._weeklyAuthority.publicationTask.factRefs=[{type:'enterprise_fact',id:'forged-fact',version:1}];await assert.rejects(f.start(changed,'shared-forged-fact'),/weekly_shared_original_identity_invalid/);
 pkg.socialContentPackage.publicationTasks[0].status='cancelled';await assert.rejects(f.start(fresh,'shared-cancelled'),/weekly_shared_original_identity_invalid/);
});

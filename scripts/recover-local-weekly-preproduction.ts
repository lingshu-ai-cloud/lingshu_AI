/** Explicit, scoped local recovery. Never creates a package, approves outbound,
 * cancels history, edits data files or invents delivery references. */
import assert from 'node:assert/strict';
const base='http://127.0.0.1:8791/api/overseas';
const programId='7f9242c2-bdeb-40ea-ae59-6c2adbc96fad',packageId='f839bcd8-af1e-4068-a229-08e245a6b0ca';
const session=await(await fetch(`${base}/auth/local-preview-session`,{method:'POST',headers:{origin:'http://127.0.0.1:5177'}})).json() as any;
assert.ok(session.token,'existing authenticated local preview session required');
const headers={authorization:`Bearer ${session.token}`,'content-type':'application/json'};
async function call(route:string,body?:unknown){
 const r=await fetch(`${base}/${route}`,{headers,...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)}),signal:AbortSignal.timeout(60000)});
 const result=await r.json() as any;
 if(!r.ok)throw Error(JSON.stringify({route,status:r.status,error:result.error,code:result.code,message:result.message}));
 return result;
}
const prefix=`social-programs/${programId}/operating-packages/${packageId}`;
let pkg=(await call(prefix)).item;
assert.equal(pkg.packageId,packageId);assert.equal(pkg.weekStart,'2026-10-12');assert.equal(pkg.weekEnd,'2026-10-18');
assert.equal(pkg.socialContentPackage.productionIdentityVersion,'shared-original.v1');
assert.equal(pkg.socialContentPackage.originalContentTarget,5);assert.equal(pkg.socialContentPackage.authorization.allowRealPublishing,false);
if(process.argv.includes('--bind-existing-facts')){
 const r=await call(`${prefix}/execution-pipeline/bind-existing-facts`,{expectedPackageVersion:pkg.version});pkg=r.item;
 console.log(JSON.stringify({operation:'bind-existing-facts',changed:r.changed,packageId,version:pkg.version,source:r.source,publications:pkg.socialContentPackage.publicationTasks.length,withFacts:pkg.socialContentPackage.publicationTasks.filter((p:any)=>p.factRefs.length).length,withAcceptanceTargets:pkg.socialContentPackage.publicationTasks.filter((p:any)=>p.metricTargets.length).length}));
}
if(process.argv.includes('--apply-template')){
 const {item}=await call(`${prefix}/automatic-schedule`,{packageVersion:pkg.version});
 const reasons:Record<string,number>={};for(const b of item.blockers??[])for(const code of b.reasons)reasons[code]=(reasons[code]??0)+1;
 console.log(JSON.stringify({operation:'automatic-schedule',version:pkg.version,status:item.status,proposalId:item.proposalId,userApproval:item.userApproval,reasons}));
 pkg=(await call(prefix)).item;
}
if(process.argv.includes('--bind-outline')){
 const evidence=await call(`${prefix}/producer-evidence?version=${pkg.version}`),options=evidence.bindingOptions.filter((o:any)=>o.kind==='outline');
 const existing=evidence.items.preproduction.filter((j:any)=>j.kind==='outline');
 if(existing.length){
  assert.equal(existing.length,1,'ambiguous original outline binding; do not create another');
  console.log(JSON.stringify({operation:'bind-outline',reused:true,jobId:existing[0].jobId,taskId:existing[0].consumerTaskId,status:existing[0].status,code:existing[0].code}));
 }else{
 assert.equal(options.length,1,'one actual outline consumer required');
 const {item}=await call(`${prefix}/producer-evidence/preproduction-authority`,{packageVersion:pkg.version,...options[0]});
 console.log(JSON.stringify({operation:'bind-outline',jobId:item.jobId,taskId:item.consumerTaskId,status:item.status,code:item.code,originalRunKey:item.originalRunKey}));
 }
}
if(process.argv.includes('--start-independent')){
 const consumer=await call(`${prefix}/execution-pipeline/connect-local-consumer`,{expectedPackageVersion:pkg.version});
 const r=await call(`${prefix}/execution-pipeline/start-independent`,{expectedPackageVersion:pkg.version});
 console.log(JSON.stringify({operation:'start-independent',version:pkg.version,consumer:consumer.item,phase:r.pipeline.executionPhase,started:r.pipeline.started}));
}
if(process.argv.includes('--bind-discovery-one')){
 const evidence=await call(`${prefix}/producer-evidence?version=${pkg.version}`),{items:tasks}=await call(`${prefix}/execution-tasks?version=${pkg.version}`);
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const existing=evidence.items.preproduction.filter((j:any)=>j.kind==='discovery');
 const eligible=tasks.filter((t:any)=>t.schedule.stepKind==='benchmark_collection'&&(t.inputSnapshot.rollingDate??t.inputSnapshot.calendarAssignmentDate)===today&&t.dependsOnTaskIds.every((id:string)=>tasks.find((p:any)=>p.taskId===id)?.status==='succeeded'));
 assert.ok(eligible.length,'today has no collection consumer with genuinely delivered upstream');
 if(existing.some((j:any)=>eligible.some((t:any)=>t.taskId===j.consumerTaskId))){console.log(JSON.stringify({operation:'bind-discovery-one',reused:true,jobs:existing.map((j:any)=>({jobId:j.jobId,status:j.status,code:j.code}))}));}
 else{
  const selected=eligible.find((t:any)=>evidence.bindingOptions.some((o:any)=>o.taskId===t.taskId));assert.ok(selected,'no current bindable collection task');
  const scope=await call('social-discovery/scope');assert.equal(scope.persisted,true);assert.equal(scope.scope.approval.status,'approved');assert.equal(scope.scope.approval.scopeVersion,1);
  assert.equal(scope.scope.keywords.filter((k:any)=>['discovery_seed','scene_cluster'].includes(k.category)).flatMap((k:any)=>k.values).length,5,'reuse exactly the existing five approved generic search terms');
  const option=evidence.bindingOptions.find((o:any)=>o.taskId===selected.taskId),{item}=await call(`${prefix}/producer-evidence/preproduction-authority`,{packageVersion:pkg.version,...option,discovery:{scopeId:'social_discovery_scopes_a4a31d045a7f4721b003816887ce8c01',scopeVersion:1,requestedModes:['momentum']}});
  console.log(JSON.stringify({operation:'bind-discovery-one',jobId:item.jobId,taskId:item.consumerTaskId,status:item.status,originalRunKey:item.originalRunKey,actualUpstreamTaskIds:selected.dependsOnTaskIds,mode:'momentum'}));
 }
}
const evidence=await call(`${prefix}/producer-evidence?version=${pkg.version}`),audit=(await call(`${prefix}/execution-pipeline/task-audit?version=${pkg.version}`)).item;
console.log(JSON.stringify({packageId,version:pkg.version,status:pkg.status,publishingAuthorized:pkg.socialContentPackage.authorization.allowRealPublishing,outline:audit.items?.filter((t:any)=>t.step==='business_outline'),preproduction:evidence.items.preproduction.map((j:any)=>({jobId:j.jobId,taskId:j.consumerTaskId,status:j.status,code:j.code,resultRefs:j.resultRefs})),total:audit.total,rootCounts:audit.rootCounts}));

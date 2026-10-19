import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from '../socialPrograms/weeklyContentTemplates.fixture.js';
import {createStarter198Repository} from './repository.js';
import {readSocialTaskDetail} from './socialContentRecords.js';
import {defaultBrief} from './socialContentTaskSupport.js';
import {SOCIAL_WORK_PACKAGE_KINDS} from '../../shared/contracts/socialContentWorkflow.js';
import {socialRequestHash} from './socialContentValidation.js';
import {createContentCreationQuotaService} from '../socialPrograms/contentCreationQuota.js';
import {reconcileSocialContentOrderProjection} from './socialContentOrderProjection.js';
import {runVisualFfmpeg} from '../lib/renderVisualQuality.js';
import {createSocialDeliveryPackage} from './socialContentOutputs.js';
import {resolveSocialContentCostLineage} from './socialContentCostLineage.js';

async function prepared(){
 const f=await fixture(),store=f.store;
 store.supportsAtomicCompareAndSwap=()=>true;
 store.compareAndSwap=async(c,id,expected,patch)=>{const r=(f.tables[c]??[]).find(x=>x.id===id);if(!r||Object.entries(expected).some(([k,v])=>JSON.stringify(r[k])!==JSON.stringify(v)))return false;Object.assign(r,structuredClone(patch));return true;};
 const originalCreate=store.create.bind(store);store.create=async(c,data)=>{if((f.tables[c]??[]).some(x=>x.id===data.id))return null;return originalCreate(c,data);};
 const task:any=f.tables.starter_social_content_tasks[0];
 Object.assign(task,{status:'asset_review',version:'2',created_at:'2026-10-16T00:00:00Z',updated_at:'2026-10-16T00:00:00Z',
   brief:defaultBrief({title:'真实视频交付',objective:'验证业务交付回写'}),task_mode:'instant',theme_selection:'',
   content_order:{schemaVersion:'social-content-order.v1',contentId:'content',budgetTaskId:'content',entry:'workspace',programId:'p',originWeek:'2026-10-12'},
   package_selection:SOCIAL_WORK_PACKAGE_KINDS.map(kind=>({kind,packageKey:kind,version:'1',name:kind}))});
 for(const k of ['source_count','knowledge_source_count','material_source_count','artifact_count','approved_artifact_count','delivery_package_count','publication_count','metric_submission_count'])task[k]=0;
 const output=path.join(path.dirname(f.local),'verified.mp4');
 const rendered=await runVisualFfmpeg(['-v','error','-f','lavfi','-i','color=c=blue:s=160x284:r=12','-t','1','-c:v','libx264','-pix_fmt','yuv420p','-y',output],false,{timeoutMs:60000});
 assert.equal(rendered.ok,true,rendered.stderr);
 const bytes=await fs.readFile(output),sha=createHash('sha256').update(bytes).digest('hex'),mediaPath=path.join(path.dirname(f.local),`${sha}.mp4`);
 await fs.rename(output,mediaPath);
 const file:any=f.tables.starter_social_content_files[0],fileId=`socialfile_${'a'.repeat(24)}`;
 Object.assign(file,{file_id:fileId,byte_size:bytes.length,content_sha256:sha,storage_key:path.relative(path.resolve('data/social-content-sources'),mediaPath),created_at:task.created_at});
 const artifact:any=f.tables.starter_social_content_artifacts[0];artifact.resource_ref=`socialfile:${fileId}`;
 artifact.content={productionResult:{technicalReview:{approved:true},creativeReview:{approved:true}},productionWorkspaceSource:{runId:'run'},render:{completed:true}};
 const freeze=()=>({artifactId:'artifact',taskId:'content',kind:'short_video',platform:null,language:null,version:'1',status:'approved',origin:'agent',resourceRef:artifact.resource_ref,content:structuredClone(artifact.content)});
 const manifest:any={schemaVersion:'social-content.delivery.v1',taskId:'content',packageId:'package',artifacts:[freeze()],media:[{artifactId:'artifact',fileRef:artifact.resource_ref,name:'video.mp4',mimeType:'video/mp4',size:bytes.length,sha256:sha}]};
 const pkg:any={id:'package-row',tenant_id:'t',task_id:'content',package_id:'package',status:'ready',manifest,package_hash:socialRequestHash(manifest),created_operation_id:'delivery-op',created_at:task.created_at};
 f.tables.starter_social_delivery_packages=[pkg];
 f.tables.starter_social_content_operations=[{id:'op',tenant_id:'t',operation_id:'delivery-op',operation:'create_social_delivery_package',target_id:'content',status:'succeeded'}];
 const scope={tenantId:'t',programId:'p',weekStart:'2026-10-12'};
 const q=createContentCreationQuotaService({store,assertAtomicStore:async()=>{},readReleaseSafety:async()=>({leaseActive:true,inFlight:true,paid:true,unknown:true}),verifyDelivery:async()=>false});
 await q.reserve(scope,{commandId:'start',actorId:'owner',reason:'confirmed original'},{contentId:'content',entry:'workspace'});
 const repository=createStarter198Repository(store),project=()=>reconcileSocialContentOrderProjection({repository,tenantId:'t',taskId:'content',now:new Date('2026-10-16T02:00:00Z')});
 return{...f,repository,task,pkg,artifact,scope,q,project,mediaPath,bytes,rehash:()=>{pkg.package_hash=socialRequestHash(pkg.manifest);}};
}
test('verified approved real MP4 settles original quota once; callbacks and restarts cannot count it again',async()=>{
 const f=await prepared();try{assert.equal((await f.project()).status,'delivered');const before=await f.q.read(f.scope);await f.project();
   const after=(await f.q.read(f.scope))!;assert.equal(after.orders.content.state,'delivered');assert.equal(after.audit.length,before!.audit.length);
   assert.equal(after.slots.filter(s=>s.contentId!==null).length,1);assert.equal(after.orders.content.productionTaskId,'content');
 }finally{await f.cleanup();}
});
test('cancelled task remains readable and a late package cannot forge delivery or consume a released slot',async()=>{
 const f=await prepared();try{
   f.task.status='cancelled';f.task.content_order.cancellation={operationId:'actual-cancel',actorId:'owner'};
   Object.assign(f.task,{artifact_count:1,approved_artifact_count:1,delivery_package_count:1});
   Object.assign(f.pkg,{artifact_ids:['artifact'],version:'1',updated_at:f.pkg.created_at});
   const detail=await readSocialTaskDetail({repository:f.repository,tenantId:'t',taskId:'content'});
   assert.equal(detail?.status,'cancelled');
   assert.equal((await f.project()).status,'cancelled');
   const order=(await f.q.read(f.scope))!.orders.content;
   assert.equal(order.state,'reserved');assert.equal(order.deliveryRef,null);
   assert.equal(f.tables.starter_social_delivery_packages.length,1);
 }finally{await f.cleanup();}
});
test('unapproved, mock and same-size changed bytes cannot become a real delivery',async()=>{
 for(const mode of ['unapproved','mock','changed']){const f=await prepared();try{
   if(mode==='unapproved')f.artifact.status='review_required';
   if(mode==='mock'){f.artifact.content.mock=true;f.pkg.manifest.artifacts[0].content.mock=true;f.rehash();}
   if(mode==='changed'){const changed=Buffer.from(f.bytes);changed[changed.length-1]^=1;await fs.writeFile(f.mediaPath,changed);}
   await assert.rejects(f.project(),/projection_|integrity/);assert.equal((await f.q.read(f.scope))!.orders.content.state,'reserved');
 }finally{await f.cleanup();}}
});
test('queued or unknown work is not delivery; only an actual live worker lease projects running',async()=>{
 const f=await prepared();try{f.tables.starter_social_delivery_packages=[];
   f.tables.content_execution_jobs=[{id:'job',tenant_id:'t',task_id:'content',run_id:'run',status:'queued',worker_id:'',lease_expires_at:'',providerReceipts:[{state:'unknown'}]}];
   assert.equal((await f.project()).status,'reserved');const job:any=f.tables.content_execution_jobs[0];
   Object.assign(job,{status:'running',worker_id:'actual-worker',lease_expires_at:'2026-10-16T03:00:00Z'});
   assert.equal((await f.project()).status,'running');assert.equal((await f.q.read(f.scope))!.orders.content.state,'running');
 }finally{await f.cleanup();}
});
test('actual delivery creation service writes back quota and idempotent replay preserves the same package and settlement',async()=>{
 const f=await prepared();try{
   f.tables.starter_social_delivery_packages=[];f.tables.starter_social_content_operations=[];
   f.task.artifact_count=1;f.task.approved_artifact_count=1;
   const input={repository:f.repository,tenantId:'t',taskId:'content',userId:'owner',idempotencyKey:'real-delivery-create',
     value:{expectedTaskVersion:'2',artifactIds:['artifact']},now:new Date('2026-10-16T02:00:00Z'),
     accessResolver:{resolve:async()=>({kind:'subscription' as const,subscription:{status:'active',plan:'test',expiresAt:null} as any})}};
   const first=await createSocialDeliveryPackage(input),replay=await createSocialDeliveryPackage(input);
   assert.equal(first.deliveryPackage.packageId,replay.deliveryPackage.packageId);
   assert.equal(f.tables.starter_social_delivery_packages.length,1);
   const order=(await f.q.read(f.scope))!.orders.content;
   assert.equal(order.state,'delivered');assert.match(order.deliveryRef!,new RegExp(first.deliveryPackage.packageId));
 }finally{await f.cleanup();}
});
test('a crash after package commit is repaired from persisted media and never creates another package',async()=>{
 const f=await prepared();try{
   f.tables.starter_social_delivery_packages=[];f.tables.starter_social_content_operations=[];
   f.task.artifact_count=1;f.task.approved_artifact_count=1;
   const cas=f.store.compareAndSwap!;f.store.compareAndSwap=async(c,...args)=>{
     if(c==='social_content_creation_quotas')throw Error('controlled_projection_crash');return cas(c,...args);
   };
   const input={repository:f.repository,tenantId:'t',taskId:'content',userId:'owner',idempotencyKey:'delivery-before-crash',
     value:{expectedTaskVersion:'2',artifactIds:['artifact']},now:new Date('2026-10-16T02:00:00Z'),
     accessResolver:{resolve:async()=>({kind:'subscription' as const,subscription:{status:'active',plan:'test',expiresAt:null} as any})}};
   await assert.rejects(createSocialDeliveryPackage(input),/controlled_projection_crash/);
   assert.equal(f.tables.starter_social_delivery_packages.length,1);
   assert.equal((await f.q.read(f.scope))!.orders.content.state,'reserved');
   f.store.compareAndSwap=cas;assert.equal((await f.project()).status,'delivered');
   await createSocialDeliveryPackage(input);assert.equal(f.tables.starter_social_delivery_packages.length,1);
 }finally{await f.cleanup();}
});
test('verified revision delivery is an audited version, not another original settlement or replacement of the old receipt',async()=>{
 const f=await prepared();try{
   await f.project();const original=(await f.q.read(f.scope))!.orders.content.deliveryRef;
   const body={schemaVersion:'social-production-revision.v1',tenantId:'t',taskId:'content',parentArtifactId:'artifact',parentArtifactVersion:'1'};
   f.task.brief._productionRevision={...body,planHash:socialRequestHash(body),preparedBy:'owner',preparedAt:'2026-10-16T02:00:00Z'};
   f.task.run_id='revision-run';
   const lineage=await resolveSocialContentCostLineage({repository:f.repository,tenantId:'t',taskId:'content'});
   const quota=createContentCreationQuotaService({store:f.store,assertAtomicStore:async()=>{},readReleaseSafety:async()=>({leaseActive:true,inFlight:true,paid:true,unknown:true}),
     verifyRevisionDispatch:async(_o,_s,v)=>v.lineageHash===lineage.lineageHash,verifyDelivery:async()=>false});
   await quota.registerRevisionDispatch(f.scope,{commandId:'revision-start',actorId:'owner',reason:'verified revision plan'},
     {contentId:'content',executionTaskId:'content',lineageHash:lineage.lineageHash});
   const artifact:any={...structuredClone(f.artifact),id:'revision-artifact-row',artifact_id:'revision-artifact',content:{...structuredClone(f.artifact.content),productionWorkspaceSource:{runId:'revision-run'}}};
   f.tables.starter_social_content_artifacts.push(artifact);
   const manifest=structuredClone(f.pkg.manifest);manifest.packageId='revision-package';
   manifest.artifacts[0]={...manifest.artifacts[0],artifactId:'revision-artifact',content:artifact.content};manifest.media[0].artifactId='revision-artifact';
   f.tables.starter_social_delivery_packages.unshift({...f.pkg,id:'revision-package-row',package_id:'revision-package',manifest,
     package_hash:socialRequestHash(manifest),created_operation_id:'revision-delivery-op',created_at:'2026-10-16T04:00:00Z'});
   f.tables.starter_social_content_operations.push({id:'revision-delivery-op',tenant_id:'t',operation_id:'revision-delivery-op',operation:'create_social_delivery_package',target_id:'content',status:'succeeded'});
   assert.equal((await f.project()).status,'delivered');await f.project();
   const pool=(await f.q.read(f.scope))!;assert.equal(pool.orders.content.deliveryRef,original);
   assert.equal(pool.orders.content.revisions![0].deliveries!.length,1);
   assert.equal(pool.slots.filter(s=>s.contentId!==null).length,1);
 }finally{await f.cleanup();}
});

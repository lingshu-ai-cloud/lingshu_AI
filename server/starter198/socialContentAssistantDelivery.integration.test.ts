import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {Server} from 'node:http';
import {LangGraphTestStore} from '../../scripts/langgraphTestStore.js';
import {runVisualFfmpeg} from '../lib/renderVisualQuality.js';
import {STARTER_198_CAPABILITIES} from '../../shared/contracts/starter198.js';
import {normalizeSceneVisualContract} from '../../shared/sceneVisualContract.js';
import {buildMaterialScriptAnalysis} from '../../shared/materialScriptAnalysis.js';
import {createStarter198Repository,STARTER_COLLECTIONS} from './repository.js';
import {createSocialContentTask} from './socialContentTasks.js';
import {parseCreateSocialTask} from './socialContentValidation.js';
import {parseStoredSocialScriptBaseline} from './socialContentScriptBaseline.js';
import {readSocialTaskDetail} from './socialContentRecords.js';
import {createStarter198OrchestratorQueue} from './orchestratorQueue.js';
import {createSocialContentRouter} from './socialContentRouter.js';
import {issueLocalIdentityTokenForTest} from '../auth/localIdentity.js';
import type {SocialContentAccessResolver} from './socialContentAccess.js';
import {projectSocialContentTaskCalendar} from '../../src/components/smartBusiness/socialContentTaskCalendar.js';

test('assistant create automatically starts and admits one real orchestrator job and calendar recovers only persisted outputs',async()=>{
  process.env.NODE_ENV='test';process.env.DISABLE_LOCAL_AUTH_FALLBACK='false';
  const root=await mkdtemp(path.join(tmpdir(),'assistant-delivery-'));
  const store=new LangGraphTestStore(path.join(root,'store.json'));
  const tenantId='assistant-delivery',now=new Date('2026-10-15T02:00:00Z');
  const materials:any[]=[];
  const repository=createStarter198Repository(store,{materialLibrary:async()=>({items:materials} as never)});
  const limits={workspaceCount:1,brandCount:1,memberCount:3,agentTeamCount:1,productCount:1,marketCount:1,buyerPersonaCount:2,languageCount:2,primaryPlatformCount:2,concurrentRunCount:1,contentArtifactCountPerCycle:20,contentRevisionCountPerCycle:3,publicationPackageCountPerContent:2,assistedSessionCount:5,inquiryAiCountPerCycle:100,quoteDraftCountPerCycle:20,highCostVideoCount:0,budgetCnyPerCycle:100,agentBudgetCny:{orchestrator:25,content:25,traffic:25,sales:25}};
  await store.create(STARTER_COLLECTIONS.access,{id:'access',tenant_id:tenantId,product_profile:'starter_198',profile_version:'starter_198.v1',entitlement_snapshot_id:'snapshot',feature_entitlements:STARTER_198_CAPABILITIES.map(capability=>({capability,enabled:true})),resource_limits:limits,status:'active',cycle_started_at:'2026-10-01T00:00:00Z',cycle_ends_at:'2026-11-01T00:00:00Z',updated_at:now.toISOString()});
  await store.create('social_programs',{id:'assistant-program',tenant_id:tenantId,program_id:'assistant-program'});
  let server:Server|undefined;
  try{
    const createBody={title:'单条产品内容',objective:'制作完整产品内容',mode:'weekly',themeId:'product_value',creationMode:'material_processing',productRef:'SKU-1',languages:['zh'],platforms:['tiktok'],dueAt:'2026-10-16T10:00:00+08:00',perItemBudgetCny:10};
    const createInput=parseCreateSocialTask(createBody);
    const task=await createSocialContentTask({repository,tenantId,userId:'operator',idempotencyKey:'assistant-create-confirmation',entry:'assistant',now,value:createInput});
    const row=(await repository.list(STARTER_COLLECTIONS.socialContentTasks,tenantId,{where:{task_id:task.taskId},perPage:2})).items[0];
    assert.ok(row);
    const baseline=parseStoredSocialScriptBaseline(row.script_baseline)!;
    for(const scene of baseline.scenes){
      const file=path.join(root,`${scene.sceneId}.mp4`),duration=4;
      const rendered=await runVisualFfmpeg(['-v','error','-f','lavfi','-i','color=c=blue:s=160x284:r=12','-t',String(duration),'-c:v','libx264','-pix_fmt','yuv420p','-y',file],false,{timeoutMs:120000});
      assert.equal(rendered.ok,true,rendered.stderr);
      const type=/消费者|使用|试用|生活/.test(scene.action)?'person_usage':'product';
      const interaction=type==='person_usage'?'person_using_product':/手持|手握|拿/.test(scene.action)?'person_holding_product':'product_only_display';
      const visual=normalizeSceneVisualContract({subjects:interaction==='product_only_display'?['product']:['person','product'],interaction:{kind:interaction,description:scene.action},action:{path:scene.action},productRef:'SKU-1',productPolicy:'locked'});
      const analysis=buildMaterialScriptAnalysis({materialId:scene.sceneId,name:scene.subject,sourceRevision:'fixture-v1',duration,productRef:'SKU-1',segments:[{id:scene.sceneId,start:0,end:duration,confidence:.99,boundaryConfidence:.99,cleanEntry:true,cleanExit:true,subject:[scene.subject],action:scene.action,observedFacts:[scene.subject,scene.action,scene.voiceover,scene.narration],visualContract:visual}]});
      analysis.shots[0]!.visualContract=visual;analysis.shots[0]!.materialRoles=[type as never];
      materials.push({id:scene.sceneId,tenantId,type:'video',sourceType:'social_task_upload',name:scene.subject,url:file,duration,productRef:'SKU-1',productName:'SKU-1',sourceRevision:'fixture-v1',scriptAnalysis:analysis,rightsStatus:'owned',width:160,height:284,contentSha256:createHash('sha256').update(await readFile(file)).digest('hex'),commercialUseApproved:true,licenseEvidence:`fixture-owned:${scene.sceneId}`});
    }
    const ready=await readSocialTaskDetail({repository,tenantId,taskId:task.taskId});
    assert.equal(ready?.agentWorkflow?.executionPlanReview?.approved,true,JSON.stringify(ready?.agentWorkflow?.executionPlanReview));
    const dispatched:Array<{taskId:string;runId:string}>=[];
    const queue=createStarter198OrchestratorQueue({repository,dataStore:store,now:()=>now,socialContentProductionRunner:async input=>{dispatched.push(input);}});
    const app=express();app.use(express.json());
    app.use('/content',createSocialContentRouter({repository,now:()=>now,resolveRole:async()=> 'owner',accessResolver:{resolve:async()=>({kind:'subscription',subscription:{status:'active',plan:'test',expiresAt:null}})} as SocialContentAccessResolver,orchestratorQueue:queue}));
    server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server!.once('listening',resolve));
    const address=server.address();assert.ok(address&&typeof address!=='string');
    const request=async(suffix:string,body?:unknown,key='assistant-start')=>{
      const result=await fetch(`http://127.0.0.1:${address.port}/content${suffix}`,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${issueLocalIdentityTokenForTest({userId:'operator',tenantId})}`,'Content-Type':'application/json','Idempotency-Key':key},...(body===undefined?{}:{body:JSON.stringify(body)})});
      return{status:result.status,body:await result.json()};
    };
    const started=await request('/assistant-actions/create',createBody,'assistant-create-confirmation');
    assert.equal(started.status,202,JSON.stringify(started.body));
    assert.equal(started.body.receipt.queued,true);assert.equal(started.body.task.executionAdmission.state,'queued');
    assert.equal(started.body.task.status,'producing');assert.ok(started.body.task.runId);
    assert.equal(dispatched.length,1,'real scheduler must hand the admitted job to its production runner');
    assert.equal(dispatched[0]!.taskId,task.taskId);
    assert.equal(dispatched[0]!.runId,started.body.task.runId);
    const duplicate=await request('/assistant-actions/create',createBody,'assistant-create-confirmation');
    assert.equal(duplicate.body.task.runId,started.body.task.runId);
    assert.equal(dispatched.length,1,'stale second click must not dispatch a second production job');
    const runs=await repository.list(STARTER_COLLECTIONS.runs,tenantId,{perPage:100});assert.equal(runs.totalItems,1);
    const [runningCard]=projectSocialContentTaskCalendar([started.body.task]);
    assert.equal(runningCard!.id,started.body.receipt.weeklyTaskId);assert.equal(runningCard!.status,'active');
    assert.match(runningCard!.output,/等待/);
    // Canonical output API persists an actual text deliverable. It must not be
    // mistaken for automatic video completion or an approved delivery package.
    const output=await request(`/tasks/${task.taskId}/artifacts`,{kind:'publish_copy',origin:'manual',content:{title:'产品使用说明',body:'展示产品外观及使用方法。'},platform:'tiktok',language:'zh'},'actual-copy');
    assert.equal(output.status,201,JSON.stringify(output.body));
    const recovered=await request(`/tasks/${task.taskId}`);
    const [card]=projectSocialContentTaskCalendar([recovered.body.task]);
    assert.equal(card!.id,runningCard!.id);assert.equal(recovered.body.task.artifactCount,1);
    assert.match(card!.output,/已回收 1 项产物/);assert.notEqual(card!.status,'completed');
    assert.equal(recovered.body.task.deliveryPackageCount,0);
  }finally{if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createProductionTestStore} from '../production/testStore.js';
import {ensureInitialShootTasks,validateInitialShootPresenter,readInitialShootTaskVersions} from './socialContentInitialShootTask.js';
import {socialRequestHash} from './socialContentValidation.js';
import type {SocialAssetSupplyPlan} from '../../shared/contracts/socialContentWorkflow.js';
import {applyInitialMaterialRecovery,materialRecoveryScopeHash} from './socialContentMaterialRecovery.js';
import {runWithContentExecutionContext} from '../contentExecution/context.js';

const plan={materialRoutingPolicyVersion:'type-aware.v3',shots:[{shotId:'speaker',requestedDescription:'真人介绍产品',
 sourceStrategy:'authorized_digital_presenter',sourceRefs:[],materialRouting:{materialType:'talking_head',
 policy:'authorized_presenter',pendingReason:'awaiting_shoot',localMatch:{state:'missing',sourceRefs:[],evidenceRef:null}}}]} as unknown as SocialAssetSupplyPlan;

test('creates one stable shoot task and requires its capture to be bound to an authorized presenter',async()=>{
 const store=createProductionTestStore(),scope={store,tenantId:'tenant',taskId:'task',runId:'run',taskVersion:'7',plan,
  scenes:[{sceneId:'speaker',duration:{startSeconds:0,endSeconds:3},audioLayers:{voiceover:'Hello product'}}] as never};
 const first=await ensureInitialShootTasks(scope),second=await ensureInitialShootTasks(scope);
 assert.deepEqual(first,second);const shootingTaskId=first.speaker!;
 assert.deepEqual(await ensureInitialShootTasks({...scope,taskVersion:'8'}),first);
 assert.deepEqual(await readInitialShootTaskVersions(store,'tenant',first),{speaker:'7'});
 await assert.rejects(ensureInitialShootTasks({...scope,taskVersion:'8',scenes:[{sceneId:'speaker',duration:{startSeconds:0,endSeconds:3},audioLayers:{voiceover:'Changed narration'}}] as never}),/identity_changed/);
 await assert.rejects(ensureInitialShootTasks({...scope,taskVersion:'8',scenes:[{sceneId:'speaker',duration:{startSeconds:0,endSeconds:4},audioLayers:{voiceover:'Hello product'}}] as never}),/identity_changed/);
 const rows=await store.list<any>('studio_shooting_tasks',{where:{tenant_id:'tenant'},perPage:10});
 assert.equal(rows.totalItems,1);assert.equal(rows.items[0]!.payload.sourceContentShotId,'speaker');
 assert.equal(rows.items[0]!.payload.expectedNarration,'Hello product');
 await assert.rejects(validateInitialShootPresenter({store,tenantId:'tenant',taskId:'task',runId:'run',taskVersion:'7',
  shotId:'speaker',planHash:socialRequestHash(plan),shootingTaskId,presenterAssetId:'person'}),/incomplete/);
 await store.update('studio_shooting_tasks',shootingTaskId,{payload:{...rows.items[0]!.payload,uploadedMaterialIds:['capture']}});
 await store.create('studio_production_defaults',{tenant_id:'tenant',payload:{presenters:[{id:'person',authorized:true,
  assetVersion:2,avatarId:'avatar',voiceId:'voice',referenceMaterialIds:['capture'],rightsEvidence:{
   authorizationRef:'document://presenter/person',consentRef:'consent://presenter/person',grantedAt:'2026-10-01T00:00:00Z',
   subjectAdultConfirmed:true,permittedProviders:['heygen'],permittedUses:['digital_presenter','voice_synthesis']}}]}});
 const accepted=await validateInitialShootPresenter({store,tenantId:'tenant',taskId:'task',runId:'run',taskVersion:'7',
  shotId:'speaker',planHash:socialRequestHash(plan),shootingTaskId,presenterAssetId:'person'});
 assert.equal(accepted.shootingTaskVersion,'7');
 assert.equal(accepted.presenterAssetId,'person');assert.equal(accepted.presenterAssetVersion,2);
 assert.match(accepted.presenterBindingHash,/^[a-f0-9]{64}$/);
 const recovery={tenantId:'tenant',taskId:'task',runId:'run',selections:{speaker:{originalPlanHash:socialRequestHash(plan),
  phase:'initial_presenter' as const,...accepted}}};
 const rebound=await runWithContentExecutionContext({dataStore:store,jobId:'job',checkpoints:{'social.material_recovery_selection':{
  version:'1',inputHash:materialRecoveryScopeHash('tenant','task','run'),payload:recovery,updatedAt:new Date().toISOString()}},
  action:()=>applyInitialMaterialRecovery({repository:{dataStore:store} as never,tenantId:'tenant',taskId:'task',runId:'run',
   taskVersion:'9',plan})});
 assert.equal(rebound.plan.shots[0]!.materialRouting!.pendingReason,undefined);
 assert.deepEqual(rebound.plan.shots[0]!.digitalHumanPlan!.presenterAssetIds,['person']);
 await store.update('studio_production_defaults',(await store.list<any>('studio_production_defaults',{where:{tenant_id:'tenant'},perPage:2})).items[0]!.id,
  {payload:{presenters:[{id:'person',authorized:true,assetVersion:2,avatarId:'avatar',voiceId:'voice',referenceMaterialIds:['other'],
   rightsEvidence:{authorizationRef:'document://presenter/person',consentRef:'consent://presenter/person',grantedAt:'2026-10-01T00:00:00Z',
   subjectAdultConfirmed:true,permittedProviders:['heygen'],permittedUses:['digital_presenter','voice_synthesis']}}]}});
 await assert.rejects(validateInitialShootPresenter({store,tenantId:'tenant',taskId:'task',runId:'run',taskVersion:'7',
  shotId:'speaker',planHash:socialRequestHash(plan),shootingTaskId,presenterAssetId:'person'}),/not_bound_to_capture/);
});

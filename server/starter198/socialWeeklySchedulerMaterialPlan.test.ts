import test from 'node:test';
import assert from 'node:assert/strict';
import type {SocialContentTaskDetail} from '../../shared/contracts/socialContentWorkflow.js';
import type {Starter198Repository,StarterRecord} from './repository.js';
import {buildWeeklySchedulerMaterialPlanProof,readWeeklySchedulerMaterialPlan} from './socialWeeklySchedulerMaterialPlan.js';

test('formal scheduler proof tolerates diagnostic inventory rereads but rejects changed shot, rights, bytes, dimensions or source authority',async()=>{
  const originalPlan={planVersion:'4',shots:[{shotId:'scene-1',referenceShotId:'reference-1',productIdentity:{productRef:'actual-product'}}],inventoryAudit:{scannedAt:'2026-10-10T01:00:00Z',records:[{id:'original-media',sha256:'a'.repeat(64),mediaType:'image',productRef:'actual-product',width:360,height:640,durationSeconds:null,rightsEvidenceRef:'frozen-license',productionEligible:true,gaps:[]}]}} as unknown as NonNullable<SocialContentTaskDetail['assetSupplyPlan']>;
  const row={id:'content-row',tenant_id:'tenant',task_id:'content',version:'4',brief:{_weeklyAuthority:{packageId:'week',packageVersion:2}},replication_script:{script:'original'},package_selection:[]} as StarterRecord;
  const detail={taskId:'content',runId:null,version:'4',sources:[],assetSupplyPlan:originalPlan} as unknown as SocialContentTaskDetail;
  const proof=buildWeeklySchedulerMaterialPlanProof({tenantId:'tenant',taskId:'content',commandId:'original-command',row,detail,sources:[]});assert(proof);
  const scheduled={...row,version:'5',run_id:'original-run',last_operation_id:'original-command'};
  const run={tenant_id:'tenant',starter_context:{schemaVersion:'starter-social-content.auto-execution.v1',socialTaskId:'content',socialTaskVersion:'4',weeklyMaterialPlan:proof}};
  const repository={dataStore:{getById:async()=>run}} as unknown as Starter198Repository;
  const current={taskId:'content',runId:'original-run',version:'5',sources:[],assetSupplyPlan:{...originalPlan,planVersion:'5'}};
  assert.deepEqual(await readWeeklySchedulerMaterialPlan(repository,scheduled,current),originalPlan);
  const reread={...current,assetSupplyPlan:{...current.assetSupplyPlan,inventoryAudit:{...originalPlan.inventoryAudit!,scannedAt:'2026-10-11T02:00:00Z'}}};
  assert.deepEqual(await readWeeklySchedulerMaterialPlan(repository,scheduled,reread),originalPlan);
  const changedShot={...current,assetSupplyPlan:{...current.assetSupplyPlan,shots:[]}};
  assert.equal(await readWeeklySchedulerMaterialPlan(repository,scheduled,changedShot),null);
  for(const change of [{sha256:'b'.repeat(64)},{rightsEvidenceRef:'replacement-license'},{productRef:'different-product'},{width:720},{height:1280},{mediaType:'video'},{durationSeconds:3},{productionEligible:false},{gaps:['rights_missing']}]){
    const altered={...current,assetSupplyPlan:{...current.assetSupplyPlan,inventoryAudit:{...originalPlan.inventoryAudit!,records:[{...originalPlan.inventoryAudit!.records[0]!,...change}]}}};
    assert.equal(await readWeeklySchedulerMaterialPlan(repository,scheduled,altered),null);
  }
  assert.equal(await readWeeklySchedulerMaterialPlan(repository,{...scheduled,brief:{_weeklyAuthority:{packageId:'replacement-week',packageVersion:2}}},current),null);
  assert.equal(await readWeeklySchedulerMaterialPlan(repository,scheduled,{...current,sources:[{sourceId:'extra-source',status:'active'} as SocialContentTaskDetail['sources'][number]]}),null);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {freezeSocialScriptBaseline} from './socialContentScriptBaseline.js';
import {prepareSocialProductionScriptBaseline} from './socialContentProductionScriptBaseline.js';
import type {Starter198Repository} from './repository.js';

test('a resumed script keeps its admitted enterprise facts without rewriting the task',async()=>{
  const admitted={productName:'原产品',facts:[],source:'enterprise_product' as const,confidence:1,
    factVersion:{id:'fact',revision:1,contentHash:'old'}};
  const newer={...admitted,productName:'新产品',factVersion:{id:'fact',revision:2,contentHash:'new'}};
  const brief={languages:['zh'],productRef:'sku'} as any;
  const baseline=freezeSocialScriptBaseline({brief,theme:{themeId:'product_value'} as any,
    verifiedContext:admitted,lockedAt:'2026-10-22T00:00:00.000Z'});
  let writes=0;
  const repository={update:async()=>{writes++;return true;}} as unknown as Starter198Repository;
  const input={repository,tenantId:'tenant',taskId:'task',runId:'run',taskRecord:{id:'row',script_baseline:baseline} as any,
    detail:{brief,replicationScript:null} as any,originalReplication:null,replicationContext:undefined,
    contentTemplateStructure:undefined,verifiedContext:newer,weeklyExecutionGraphVersion:1,existingWeeklyPreSupply:null};
  const resumed=await prepareSocialProductionScriptBaseline(input);
  assert.deepEqual(resumed.baseline,baseline);
  assert.deepEqual(resumed.executionVerifiedContext,baseline.verifiedContextSnapshot);
  assert.equal(writes,0);

  const historic={...baseline};
  delete historic.verifiedContextSnapshot;
  await assert.rejects(prepareSocialProductionScriptBaseline({...input,taskRecord:{id:'row',script_baseline:historic} as any}),
    /social_content_enterprise_fact_replan_required/);
  assert.equal(writes,0);
});

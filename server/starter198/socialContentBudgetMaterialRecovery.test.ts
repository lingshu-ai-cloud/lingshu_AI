import test from 'node:test';import assert from 'node:assert/strict';
import {readSocialBudgetMaterialAllocation} from './socialContentBudgetMaterialRecovery.js';import {socialRequestHash} from './socialContentValidation.js';
test('funded film restores exact routes across inventory observations, rejects source/baseline/funding changes',async()=>{
 const plan={planVersion:'14',shots:[{shotId:'s',sourceStrategy:'customer_real_asset',sourceRefs:['real'],selectedMaterialSegment:{startSeconds:1,endSeconds:2}}],inventoryAudit:{scannedAt:'old',records:[]}};
 const saved={plan,planHash:socialRequestHash(plan)},cp={'social.executor':{inputHash:'original'},'social.whole_film_budget':{inputHash:'original',payload:{baselineHash:'baseline',paidBaselineContractHash:'same-paid-contract'}},'social.budget_material_routing':{version:'1',payload:saved}};
 const input={repository:{dataStore:{list:async()=>({totalItems:1,items:[{checkpoints:cp}]})}},tenantId:'t',taskId:'task',runId:'run',allocationHash:'new-observation',baselineHash:'baseline',plan:{...plan,inventoryAudit:{scannedAt:'new',records:[]}}} as unknown as Parameters<typeof readSocialBudgetMaterialAllocation>[0];
 assert.deepEqual(await readSocialBudgetMaterialAllocation(input),saved);
 const explained=structuredClone(input.plan);explained.shots[0]!.productionInstruction='allocator explanation';explained.shots[0]!.feasibilityReason='selected local base';assert.deepEqual(await readSocialBudgetMaterialAllocation({...input,plan:explained}),saved);
 assert.deepEqual(await readSocialBudgetMaterialAllocation({...input,baselineHash:'harmless-metadata',baselineContractHash:'same-paid-contract'}),saved);
 await assert.rejects(readSocialBudgetMaterialAllocation({...input,baselineHash:'changed'}),/funded_selection_changed/);
 const changed=structuredClone(input.plan);changed.shots[0]!.sourceRefs=['different'];await assert.rejects(readSocialBudgetMaterialAllocation({...input,plan:changed}),/funded_selection_changed/);
 saved.planHash='corrupt';await assert.rejects(readSocialBudgetMaterialAllocation(input),/funded_selection_changed/);
});

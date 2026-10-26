import type { SocialEnterpriseProductBinding } from './socialContentTaskEvidenceProjection.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { SocialReplicationScriptVersion } from '../../shared/contracts/socialContentWorkflow.js';
import { bindReplicationProduct } from './socialReplicationProductBinding.js';
import { socialReplicationIdentityGaps } from './socialContentReplicationScriptReview.js';
const binding = {productId:'sku-1',productName:'产品',enterpriseFactRef:'enterprise_fact:1@2'} as SocialEnterpriseProductBinding;
const script = {status:'review_required',shots:[{shotId:'s1',materialPlan:{visualContract:{subjects:[{kind:'product'}],product:{policy:'preferred',source:'agent_inferred'},productUsage:{kind:'show'}},truthBoundary:{confirmedFactRefs:[]},feasibility:'blocked_for_facts_or_rights'}}]} as unknown as SocialReplicationScriptVersion;
test('explicit verified product is bound before planning without approving blocked work or modifying reference',()=>{
 const result=bindReplicationProduct(script,binding);
 assert.deepEqual(socialReplicationIdentityGaps(result,binding),[]);
 assert.equal(result.status,'review_required');assert.equal(result.shots[0].materialPlan.feasibility,'blocked_for_facts_or_rights');
 assert.equal(script.shots[0].materialPlan.visualContract!.product.source,'agent_inferred');
 assert.equal(bindReplicationProduct(script,null),script);
 assert.equal(bindReplicationProduct({...script,status:'confirmed'},binding).shots,script.shots);
 const conflict=structuredClone(result);conflict.shots[0].materialPlan.visualContract!.product.requestedProductId='other';
 assert.throws(()=>bindReplicationProduct(conflict,binding),/binding_conflict/);
});

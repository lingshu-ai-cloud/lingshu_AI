import test from 'node:test';
import assert from 'node:assert/strict';
import type {SocialAssetSupplyPlan} from '../../shared/contracts/socialContentReplication.js';
import {socialAssetSupplyPlanIdentityHash} from './socialAssetSupplyPlanIdentity.js';

test('re-reading inventory time and order preserves plan identity but physical and authority changes do not',()=>{
 const records=[{id:'b',sha256:'a'.repeat(64),rightsEvidenceRef:'actual-license',width:360,height:640,productionEligible:true},{id:'a',sha256:'b'.repeat(64),rightsEvidenceRef:'other-license',width:640,height:360,productionEligible:true}];
 const plan={planVersion:'4',shots:[{shotId:'scene-original',referenceShotId:'reference-original',productIdentity:{productRef:'product-original'}}],inventoryAudit:{scannedAt:'2026-10-10T01:00:00Z',records}} as unknown as SocialAssetSupplyPlan;
 const original=socialAssetSupplyPlanIdentityHash(plan);
 assert.equal(socialAssetSupplyPlanIdentityHash({...plan,inventoryAudit:{...plan.inventoryAudit!,scannedAt:'2026-10-11T02:00:00Z',records:[...plan.inventoryAudit!.records].reverse()}}),original);
 for(const change of [{sha256:'c'.repeat(64)},{rightsEvidenceRef:'replacement-license'},{width:480},{productionEligible:false}])assert.notEqual(socialAssetSupplyPlanIdentityHash({...plan,inventoryAudit:{...plan.inventoryAudit!,records:[{...plan.inventoryAudit!.records[0]!,...change},plan.inventoryAudit!.records[1]!]}}),original);
 const extraAuthority={...plan.inventoryAudit!,rightsAuthorityRevision:'new-actual-authority'};
 assert.notEqual(socialAssetSupplyPlanIdentityHash({...plan,inventoryAudit:extraAuthority}),original,'only scannedAt is omitted; future authority fields remain part of identity');
 assert.notEqual(socialAssetSupplyPlanIdentityHash({...plan,planVersion:'5'}),original);
});

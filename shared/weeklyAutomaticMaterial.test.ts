import assert from 'node:assert/strict';
import test from 'node:test';
import { weeklyAssetRequirementIdentity,checkWeeklyMaterialAutomatically,type WeeklyAssetRequirement,type AutomaticMaterialEvidence } from './weeklyAutomaticMaterial.js';
const requirement:WeeklyAssetRequirement={subjectRef:'product-1',action:'rotate',scene:'studio',evidenceRequirement:'product_identity',aspectRatio:'9:16',minimumDurationSeconds:3,authorizationScope:'enterprise-video'};
const sha='a'.repeat(64);
const evidence:AutomaticMaterialEvidence={...requirement,sha256:sha,durationSeconds:4,authorizationScopes:['enterprise-video'],rightsEvidenceRef:'consent-1',qualityPassed:true,model:'actual-analysis'};
test('shared identity includes subject, action, scene, evidence, format, duration and rights scope',()=>{
 const key=weeklyAssetRequirementIdentity(requirement);
 for(const field of ['subjectRef','action','scene','evidenceRequirement','aspectRatio','authorizationScope'] as const)assert.notEqual(key,weeklyAssetRequirementIdentity({...requirement,[field]:'other'}));
 assert.notEqual(key,weeklyAssetRequirementIdentity({...requirement,minimumDurationSeconds:4}));
 assert.throws(()=>weeklyAssetRequirementIdentity({...requirement,action:''}));
});
test('byte-bound automatic check needs real facts, rights and visual evidence; absent or stale analysis never passes',()=>{
 assert.equal(checkWeeklyMaterialAutomatically(requirement,sha,evidence).accepted,true);
 for(const patch of [{sha256:'b'.repeat(64)},{subjectRef:'other'},{rightsEvidenceRef:''},{authorizationScopes:['other']},{qualityPassed:false},{durationSeconds:1},{action:'other'}])assert.equal(checkWeeklyMaterialAutomatically(requirement,sha,{...evidence,...patch}).accepted,false);
 assert.equal(checkWeeklyMaterialAutomatically(requirement,sha,null).accepted,false);
});

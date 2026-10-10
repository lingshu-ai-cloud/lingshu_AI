import assert from 'node:assert/strict';
import test from 'node:test';
import {uploadAutomaticMaterialEvidence,generatedAutomaticMaterialEvidence} from './weeklyAutomaticMaterialProducer.js';
import {checkWeeklyMaterialAutomatically} from '../../shared/weeklyAutomaticMaterial.js';
const sha='a'.repeat(64);
const base={sha256:sha,model:'actual-source-vision',aspectRatio:'9:16',durationSeconds:4,decoded:true,qualityPassed:true,observations:[{subjectRef:'pump',action:'rotate',scene:'studio',confidence:.95,needsReview:false}],commercialUseApproved:true,rightsEvidenceRef:'license-receipt-1',authorizationScopes:['enterprise-video']};
test('upload producer only records independent high-confidence observations with actual quality and rights',()=>{
 const evidence=uploadAutomaticMaterialEvidence(base);assert.equal(evidence.length,1);
 const requirement={subjectRef:'pump',action:'rotate',scene:'studio',evidenceRequirement:'visible_subject',aspectRatio:'9:16',minimumDurationSeconds:3,authorizationScope:'enterprise-video'};
 assert.equal(checkWeeklyMaterialAutomatically(requirement,sha,evidence[0]!).accepted,true);
 for(const patch of [{commercialUseApproved:false},{rightsEvidenceRef:'tenant_upload_unverified'},{qualityPassed:false},{decoded:false},{authorizationScopes:[]},{observations:[{...base.observations[0]!,needsReview:true}]}])assert.deepEqual(uploadAutomaticMaterialEvidence({...base,...patch}),[]);
 assert.equal(checkWeeklyMaterialAutomatically(requirement,'b'.repeat(64),evidence[0]!).accepted,false);
});
test('generated producer requires actual hash, independent pipeline quality and explicit rights; prompts alone cannot pass',()=>{
 const requirement={subjectRef:'product-1',action:'orbit',scene:'studio',evidenceRequirement:'product_identity',aspectRatio:'9:16',minimumDurationSeconds:3,authorizationScope:'tenant_generated_reusable'};
 const input:any={tenantId:'t',media:{contentSha256:sha,duration:4},generation:{model:'actual-generator'},quality:{state:'accepted',checks:[{key:'product_identity',status:'passed',evidence:'actual-inspection'}]},rightsScope:'tenant_generated_reusable',automaticMaterial:{requirement,independentVisualCheckRef:'actual-inspection',rightsEvidenceRef:'source-product-commercial-license',authorizationScopes:['tenant_generated_reusable']}};
 assert.equal(generatedAutomaticMaterialEvidence(input,sha)?.qualityPassed,true);
 assert.equal(generatedAutomaticMaterialEvidence(input,'b'.repeat(64)),null);
 assert.equal(generatedAutomaticMaterialEvidence({...input,automaticMaterial:{...input.automaticMaterial,rightsEvidenceRef:''}},sha),null);
 assert.equal(generatedAutomaticMaterialEvidence({...input,quality:{...input.quality,checks:[{key:'provider_completed',status:'passed',evidence:'actual-task'}]}},sha),null);
});

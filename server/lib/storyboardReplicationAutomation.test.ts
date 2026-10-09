import assert from 'node:assert/strict';
import { applyStoryboardReplicationAutomation, automaticStoryboardFrameAdmission, buildStoryboardQaReport } from './storyboardAigcQuality.js';
const base={phase:'first_frame' as const,sceneType:'product' as const,hasProduct:true,hasNamedPerson:false,hasEnvironmentReference:true,hasContact:true,hasAction:false,evidenceFrameLabels:['候选首帧']};
const original=buildStoryboardQaReport({...base,observations:[{key:'environment_fidelity',verdict:'fail',note:'背景不同'},{key:'product_identity',verdict:'uncertain',note:'文字不可确认'}]});
const automated=applyStoryboardReplicationAutomation(original);
assert.equal(automated.passed,false);assert.equal(automated.requiresHumanReview,false);
assert.equal(automated.automatedPassed,false,'uncertain must not become a claimed vision pass');
assert.equal(automated.acceptanceSource,'automatic_policy');
assert(!automated.findings.some(item=>item.key==='environment_fidelity'));
assert(automated.findings.some(item=>item.key==='product_identity'&&item.verdict==='uncertain'&&item.severity==='hard_failure'));
assert.equal(original.status,'retry_first_frame','original report is not mutated');
for (const key of ['product_identity','visual_integrity','contact']) {
 const rejected=applyStoryboardReplicationAutomation(buildStoryboardQaReport({...base,observations:[{key,verdict:'fail',evidenceFrames:['候选首帧'],note:'真实质量失败',action:'retry_first_frame'}]}));
 assert.equal(rejected.passed,false,`${key} hard failure must block`);assert.equal(rejected.status,key==='product_identity'?'retry_first_frame':'needs_assets');
}
const p={shotSpec:{mode:'replication',constraints:['product_identity']},firstFrameQuality:original};
assert.equal(automaticStoryboardFrameAdmission(p),false,'unverified product identity cannot enter automated production');
assert.equal(automaticStoryboardFrameAdmission({...p,shotSpec:{mode:'free_creation',constraints:[]}}),false);
assert.equal(automaticStoryboardFrameAdmission({...p,shotSpec:{mode:'replication',constraints:['person_identity']}}),false,'person path is handled separately');
assert.equal(automaticStoryboardFrameAdmission({...p,firstFrameQuality:undefined}),false,'missing QA is not execution evidence');
assert.equal(automated.reviewedBy,undefined);assert.equal(automated.reviewDecision,undefined);

import assert from 'node:assert/strict';
import { applyStoryboardReplicationAutomation, automaticManagedFallbackFrameAdmission, automaticManagedFallbackVideoAdmission, automaticStoryboardFrameAdmission, buildStoryboardQaReport } from './storyboardAigcQuality.js';
const base={phase:'first_frame' as const,sceneType:'product' as const,hasProduct:true,hasNamedPerson:false,hasEnvironmentReference:true,hasContact:true,hasAction:false,evidenceFrameLabels:['候选首帧']};
const original=buildStoryboardQaReport({...base,observations:[{key:'environment_fidelity',verdict:'fail',note:'背景不同'},{key:'product_identity',verdict:'uncertain',note:'文字不可确认'}]});
const automated=applyStoryboardReplicationAutomation(original);
assert.equal(automated.passed,false);assert.equal(automated.requiresHumanReview,false);
assert.equal(automated.automatedPassed,false,'uncertain must not become a claimed vision pass');
assert.equal(automated.acceptanceSource,undefined);
assert(automated.findings.some(item=>item.key==='environment_fidelity'&&item.severity==='hard_failure'));
assert.equal(automated.checks.environment_fidelity.verdict,'fail');
assert.equal(automated.backgroundCheckPolicy,undefined);
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

const fallbackPass = buildStoryboardQaReport({ ...base, hasEnvironmentReference: false, hasContact: false,
  observations: ['product_identity', 'packaging_visibility', 'subject_visibility', 'layout', 'visual_integrity'].map(key => ({ key, verdict: 'pass', evidenceFrames: ['候选首帧'], note: '真实抽帧通过' })) });
const fallbackProvenance = { mode: 'free_creation', firstFrameQualityState: 'evaluated',
  shotSpec: { mode: 'free_creation', constraints: ['product_identity'] }, firstFrameQuality: fallbackPass };
assert.equal(automaticManagedFallbackFrameAdmission(fallbackProvenance,
  { mode: 'ai', fallbackMode: 'enterprise_product_display' }), true,
'a current server-owned enterprise-product fallback may reuse its all-pass frame');
assert.equal(automaticManagedFallbackFrameAdmission(fallbackProvenance,
  { mode: 'ai' }), false, 'ordinary free creation cannot promote itself into automation');
assert.equal(automaticManagedFallbackFrameAdmission({ ...fallbackProvenance,
  shotSpec: { mode: 'free_creation', constraints: ['product_identity', 'person_identity'] } },
{ mode: 'ai', fallbackMode: 'enterprise_product_display' }), false, 'person identity never uses fallback auto-admission');

const fallbackVideoPass = buildStoryboardQaReport({ ...base, phase: 'video', hasEnvironmentReference: false, hasContact: false,
  evidenceFrameLabels: ['0s', '3.5s'],
  observations: ['product_identity', 'packaging_visibility', 'subject_visibility', 'layout_continuity', 'visual_integrity'].map(key => ({ key, verdict: 'pass', evidenceFrames: ['0s', '3.5s'], note: '真实视频抽帧通过' })) });
const fallbackVideoProvenance = { shotSpec: { mode: 'free_creation', constraints: ['product_identity'] },
  storyboardQualityReport: fallbackVideoPass };
assert.equal(automaticManagedFallbackVideoAdmission(fallbackVideoProvenance,
  { mode: 'ai', fallbackMode: 'enterprise_product_display' }), true,
'verified enterprise-product fallback video may proceed only after its own all-pass QA');
assert.equal(automaticManagedFallbackVideoAdmission(fallbackVideoProvenance,
  { mode: 'ai' }), false, 'ordinary free-creation video is never auto-admitted');

const factoryBase = { phase: 'video' as const, sceneType: 'factory' as const, hasProduct: false, hasNamedPerson: false, hasEnvironmentReference: true, hasContact: false, hasAction: false, evidenceFrameLabels: ['视频0s', '视频4s'] };
const factoryChecks = ['environment_fidelity', 'layout_continuity', 'visual_integrity'];
const factoryReport = (verdict: 'pass' | 'fail' | 'uncertain') => buildStoryboardQaReport({ ...factoryBase, observations: factoryChecks.map(key => ({ key, verdict: key === 'environment_fidelity' ? verdict : 'pass', evidenceFrames: ['视频0s', '视频4s'], note: '实际抽帧核验' })) });
const factoryFailed = applyStoryboardReplicationAutomation(factoryReport('fail'));
assert.equal(factoryFailed.passed, false, 'factory mismatch must block automatic admission');
assert.equal(factoryFailed.status, 'retry_video');
const factoryUnknown = applyStoryboardReplicationAutomation(factoryReport('uncertain'));
assert.equal(factoryUnknown.passed, false);
assert.equal(factoryUnknown.requiresHumanReview, true);
assert.equal(factoryUnknown.status, 'needs_review');
assert.equal(factoryUnknown.acceptanceSource, undefined);
const factoryPassed = applyStoryboardReplicationAutomation({ ...factoryReport('pass'), reviewedBy: 'old-reviewer', reviewedAt: 'old-time', reviewDecision: 'accept' });
assert.equal(factoryPassed.passed, true);
assert.equal(factoryPassed.acceptanceSource, 'automatic_policy');
assert.equal(factoryPassed.reviewedBy, undefined, 'automation never impersonates a reviewer');
assert.equal(factoryPassed.reviewedAt, undefined);
assert.equal(factoryPassed.reviewDecision, undefined);

import assert from 'node:assert/strict';
import test from 'node:test';
import {upgradeSocialArtifactTechnicalPolicy} from './socialContentTechnicalPolicyUpgrade.js';
import {SOCIAL_TECHNICAL_REVIEW_POLICY} from './socialContentTechnicalReplayEvidence.js';
const artifact={artifactId:'parent',content:{workflowSchema:'social-content.auto-production.v3',productionWorkspaceSource:{runId:'run',outputSha256:'a'.repeat(64)},technicalQualityReport:{policyVersion:'old'}}} as never;
const input={tenantId:'tenant',taskId:'task',runId:'run',userId:'user',repository:{list:async()=>({totalItems:1,items:[{version:'2',content_hash:'b'.repeat(64)}]})}} as never;
test('same policy and foreign run never reach local QA or production',async()=>{
 const value=structuredClone(artifact) as Record<string,any>;value.content.technicalQualityReport.policyVersion=SOCIAL_TECHNICAL_REVIEW_POLICY;
 const service=()=>{throw Error('must not execute');};
 assert.equal(await upgradeSocialArtifactTechnicalPolicy(input,value as never,false,{service}),value);
 value.content.technicalQualityReport.policyVersion='old';value.content.productionWorkspaceSource.runId='other';
 assert.equal(await upgradeSocialArtifactTechnicalPolicy(input,value as never,false,{service}),value);
});
test('weekly policy migration preserves parent and reports stable cache boundary',async()=>{
 await assert.rejects(upgradeSocialArtifactTechnicalPolicy(input,artifact,true,{service:()=>{throw Error('must not execute');}}),/social_technical_reevaluation_weekly_cache_migration_required/);
});
test('single-task policy upgrade invokes only technical same-run service',async()=>{
 let calls=0;const child={artifactId:'child'};
 const result=await upgradeSocialArtifactTechnicalPolicy(input,artifact,false,{service:(()=>({reevaluate:async(request:Record<string,unknown>)=>{
  calls++;assert.equal(request.mode,'technical');assert.equal(request.expectedRunId,'run');assert.equal(request.parentArtifactVersion,'2');assert.equal(request.parentContentHash,'b'.repeat(64));return {artifact:child};
 }})) as never});assert.equal(result,child);assert.equal(calls,1);
});

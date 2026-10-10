import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {
  assertWeeklyTechnicalRepairReconcileBody,
  parseWeeklyCreativeRepairConfigurationBody,
  parseWeeklyTechnicalQualityRecoveryBody,
} from './socialPrograms.js';

const hash='a'.repeat(64);

test('weekly repair route boundary passes only frozen creative configuration intent',()=>{
  const body={packageVersion:3,expectedCaseHash:hash,revisionScope:'只修订 CTA 分镜',estimatedDurationMinutes:30,maximumCostCny:12.5,deadlineAt:'2026-10-12T08:00:00Z'};
  assert.deepEqual(parseWeeklyCreativeRepairConfigurationBody(body),{
    expectedCaseHash:hash,revisionScope:'只修订 CTA 分镜',estimatedDurationMinutes:30,maximumCostCny:12.5,deadlineAt:'2026-10-12T08:00:00Z',
  });
  for(const invalid of [null,[],{...body,actorUserId:'foreign'},{...body,revisionScope:' padded '},{...body,estimatedDurationMinutes:0},{...body,maximumCostCny:Infinity},{...body,deadlineAt:'later'}]){
    assert.throws(()=>parseWeeklyCreativeRepairConfigurationBody(invalid),{code:'weekly_creative_repair_input_invalid'});
  }
});

test('weekly technical completion route boundary rejects forged authority and malformed recovery identity',()=>{
  assert.doesNotThrow(()=>assertWeeklyTechnicalRepairReconcileBody({packageVersion:3}));
  for(const invalid of [null,[],{packageVersion:3,state:'resolved'},{packageVersion:3,childArtifactRef:{id:'forged'}}]){
    assert.throws(()=>assertWeeklyTechnicalRepairReconcileBody(invalid),{code:'weekly_repair_reconcile_input_invalid'});
  }
  const input={packageVersion:3,requestId:'repair-quality-request-0001',expectedContextHash:hash};
  assert.deepEqual(parseWeeklyTechnicalQualityRecoveryBody(input),{requestId:input.requestId,expectedContextHash:hash});
  for(const invalid of [{...input,requestId:'short'},{...input,expectedContextHash:'bad'},{...input,executionTaskId:'forged'},{...input,ownerUserId:'foreign'}]){
    assert.throws(()=>parseWeeklyTechnicalQualityRecoveryBody(invalid),{code:'weekly_repair_quality_recovery_input_invalid'});
  }
});

test('parent router mounts the three repair transitions on the scoped case resource',async()=>{
  const source=await readFile(new URL('./socialPrograms.ts',import.meta.url),'utf8');
  for(const action of ['configure','reconcile','recover-quality'])assert.match(source,new RegExp(`repair-cases/:caseId/${action.replace('-','\\-')}`));
  assert.match(source,/technicalRepairCompletion\.reconcile\(scope\.tenantId,scope\.userId,scope\.caseId\)/);
  assert.match(source,/technicalRepairCompletion\.recoverQuality\(scope\.tenantId,scope\.userId,scope\.caseId,input\)/);
  assert.match(source,/creativeRepairConfiguration\.configure\(scope\.tenantId,scope\.userId,scope\.caseId,input\)/);
});

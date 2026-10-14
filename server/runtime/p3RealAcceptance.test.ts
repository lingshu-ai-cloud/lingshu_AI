import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { p3RuntimeConfigurationProbe, verifyP3RealAcceptance, type P3AcceptanceManifest, type P3AcceptanceRun } from './p3RealAcceptance.js';
import { readyFixture } from './weeklyAgentReleaseGate.test.fixture.js';

const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
test('requires three genuine unique runs plus recovery and scene rework', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'p3-real-'));
  const runs: P3AcceptanceRun[] = [];
  for (let index=0; index<3; index++) {
    const bytes=Buffer.from(`real-provider-film-${index}`), mp4Path=path.join(root,`${index}.mp4`); await writeFile(mp4Path,bytes);
    const gate=readyFixture(); gate.weekly.runId=`run-${index}`; gate.weekly.taskId=`task-${index}`;
    gate.handoff.taskId=`task-${index}`; gate.queue.runId=`run-${index}`; gate.queue.taskId=`task-${index}`; gate.graph.identity.runId=`run-${index}`; gate.graph.identity.taskId=`task-${index}`;
    runs.push({runLabel:`run-${index}`,weeklyPlanId:`weekly-${index}`,productionPlanHash:sha(`plan-${index}`),graphThreadId:`thread-${index}`,
      checkpointRefs:[`checkpoint-${index}`],providerReceipts:[{provider:'seedance',requestId:`request-${index}`,providerTaskId:`provider-${index}`,state:'completed',acceptedAt:new Date().toISOString(),completedAt:new Date().toISOString(),actualCostCny:0.2}],mp4Path,mp4Sha256:sha(bytes),humanApprovalReceipt:gate.graph.approval!.receiptRef,deliveryArtifactId:gate.delivery.artifactId,gate,
      ...(index===1?{recovery:{interrupted:true as const,resumedFromCheckpoint:'checkpoint-1',priorAttempt:1,resumedAttempt:2,graphThreadId:'thread-1'}}:{}),
      ...(index===2?{sceneRework:{sceneId:'scene-a',correctionHash:sha('fix'),beforeSha256:sha('before'),afterSha256:sha('after')}}:{})});
  }
  assert.deepEqual(await verifyP3RealAcceptance({schemaVersion:'weekly-agent-p3-acceptance.v1',createdAt:new Date().toISOString(),runs} as P3AcceptanceManifest),{accepted:true,issues:[]});
  runs[0]!.providerReceipts[0]!.synthetic=true;
  assert.ok((await verifyP3RealAcceptance({schemaVersion:'weekly-agent-p3-acceptance.v1',createdAt:new Date().toISOString(),runs} as P3AcceptanceManifest)).issues.some(item=>item.code==='genuine_provider_completion_receipt_missing'));
  runs[0]!.providerReceipts[0]!.synthetic=false;runs[0]!.providerReceipts[0]!.acceptedAt='not-a-date';
  assert.ok((await verifyP3RealAcceptance({schemaVersion:'weekly-agent-p3-acceptance.v1',createdAt:new Date().toISOString(),runs} as P3AcceptanceManifest)).issues.some(item=>item.code==='genuine_provider_completion_receipt_missing'));
  runs[0]!.providerReceipts[0]!.acceptedAt=runs[0]!.providerReceipts[0]!.completedAt;runs[1]!.providerReceipts[0]!.requestId=runs[0]!.providerReceipts[0]!.requestId;runs[1]!.providerReceipts[0]!.providerTaskId=runs[0]!.providerReceipts[0]!.providerTaskId;
  assert.ok((await verifyP3RealAcceptance({schemaVersion:'weekly-agent-p3-acceptance.v1',createdAt:new Date().toISOString(),runs} as P3AcceptanceManifest)).issues.some(item=>item.code==='provider_receipt_reused_across_runs'));
});
test('runtime probe reports configured values as ready without leaking them',()=>{
  const report=p3RuntimeConfigurationProbe({STARTER_198_ORCHESTRATOR_WORKER_ENABLED:'true',SOCIAL_WEEKLY_EXECUTION_WORKER_ENABLED:'true',DASHSCOPE_API_KEY:'secret',QWEN_DIGITAL_HUMAN_QA_MODEL:'model'} as NodeJS.ProcessEnv,{localVisual:{ready:true},autoRelease:{ready:true}});
  assert.equal(report.ready,true);assert.equal(JSON.stringify(report).includes('secret'),false);
});

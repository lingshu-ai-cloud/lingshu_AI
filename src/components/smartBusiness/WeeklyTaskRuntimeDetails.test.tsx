import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { WeeklyTaskWorkspace } from '../../../shared/contracts/weeklyTaskWorkspace';
import WeeklyTaskRuntimeDetails from './WeeklyTaskRuntimeDetails';

const workspace: WeeklyTaskWorkspace = {
  schemaVersion: 'weekly-task-workspace.v1', workspaceId: 'workspace-1', tenantId: 'tenant-1', programId: 'program-1', packageId: 'package-1', packageVersion: 3,
  executionTaskId: 'execution-1', taskIdempotencyKey: 'intent-1', stepKind: 'video_generation', kind: 'content', phase: 'blocked', title: '制作任务', responsibleActor: 'content_agent', taskStatus: 'blocked', scheduledStartAt: null, scheduledFinishAt: null,
  upstreamTaskIds: [], blockingCodes: ['provider_wait'], resultRefs: [], contentTaskId: 'content-1', runId: 'run-1', accountId: null, publicationTaskId: 'publication-1', createdAt: '2026-10-20T01:00:00.000Z', updatedAt: '2026-10-20T02:00:00.000Z',
  runtime: {
    pendingMaterials: [],
    initialMaterialBlocks: [],
    preRunMaterialRequests: [],
    videoQuality: null,
    pauseReasons: [{ code: 'provider_wait', message: '供应商任务暂停', retryable: true, occurredAt: '2026-10-20T01:30:00.000Z' }],
    completedWork: [{ executionTaskId: 'execution-upstream', stepKind: 'director_analysis', finishedAt: '2026-10-20T01:10:00.000Z', resultRefs: [{ type: 'director_analysis', id: 'analysis-1', version: 1 }] }],
    actualCost: { status: 'known', totalCny: 12.5, evidenceRefs: ['ledger-1'] },
    recovery: { taskAttempt: 2, taskMaximumAttempts: 3, recoveredFromDeadLetterAt: null, jobId: 'job-1', jobStatus: 'blocked', jobAttempt: 2, reconciliationAttempt: 1, retryClass: 'provider_wait', nextAttemptAt: '2026-10-20T02:30:00.000Z', providerReceipts: [{ provider: 'mock-provider', requestId: 'request-1', state: 'pending', providerTaskId: 'provider-task-1', updatedAt: '2026-10-20T02:00:00.000Z' }] },
    checkpoints: [{ key: 'render', version: '2', inputHash: 'a'.repeat(64), updatedAt: '2026-10-20T02:00:00.000Z' }],
    nextActions: [{ code: 'resolve_task_blocker', label: '核验供应商结果', userRequired: true }],
    mayChargeAgain: { status: 'possible', reason: '重新提交供应商前必须再次授权费用。' },
  },
};

test('runtime evidence stays bound to one execution task and exposes intervention facts', () => {
  const html = renderToStaticMarkup(<WeeklyTaskRuntimeDetails executionTaskId="execution-1" loading={false} error="" workspace={workspace}/>);
  assert.match(html, /data-execution-task-id="execution-1"/);
  for (const label of ['暂停原因', '已完成工作', '真实费用', 'Job / Checkpoint / 恢复证据', '下一动作', '再次执行可能产生费用']) assert.match(html, new RegExp(label));
  assert.match(html, /¥12\.50/);
  assert.match(html, /job-1/);
  assert.match(html, /request-1/);
  assert.match(html, /需要用户处理/);
  const rejected = renderToStaticMarkup(<WeeklyTaskRuntimeDetails executionTaskId="another-execution" loading={false} error="" workspace={workspace}/>);
  assert.match(rejected, /任务运行证据身份不一致/);
  assert.doesNotMatch(rejected, /¥12\.50|job-1|request-1/);
});
test('initial material blockers distinguish waiting shoots from theme gaps and reference estimates',()=>{
 const withSlots={...workspace,runtime:{...workspace.runtime,initialMaterialBlocks:[{shotId:'a',materialType:'talking_head' as const,reason:'awaiting_shoot' as const,referenceDurationSeconds:2,shootingTaskId:'shoot-a'},{shotId:'b',materialType:'factory' as const,reason:'awaiting_theme_material' as const,referenceDurationSeconds:null,shootingTaskId:null}]}};
 const html=renderToStaticMarkup(<WeeklyTaskRuntimeDetails executionTaskId="execution-1" loading={false} error="" workspace={withSlots}/>);
 assert.match(html,/真人口播待拍/);assert.match(html,/工厂主题待补素材/);assert.match(html,/参考 2\.00 秒/);assert.match(html,/尚未经过口播校准/);
});
test('only evidenced measured-material slots appear in the original task drawer',()=>{
 const withSlot={...workspace,runtime:{...workspace.runtime,pendingMaterials:[{shotId:'shot-2',theme:'factory' as const,requiredSeconds:2.5,reason:'awaiting_theme_material' as const}]}};
 const html=renderToStaticMarkup(<WeeklyTaskRuntimeDetails executionTaskId="execution-1" loading={false} error="" workspace={withSlot}/>);
 assert.match(html,/分镜 shot-2/);assert.match(html,/工厂主题/);assert.match(html,/2\.50 秒/);assert.match(html,/进入原内容任务/);assert.doesNotMatch(html,/待拍/);
 const empty=renderToStaticMarkup(<WeeklyTaskRuntimeDetails executionTaskId="execution-1" loading={false} error="" workspace={workspace}/>);assert.doesNotMatch(empty,/待补分镜|待拍/);
});

test('blocked quality evidence describes sample outcomes without implying acceptance',()=>{
 const withQuality={...workspace,runtime:{...workspace.runtime,videoQuality:{mediaSha256:'a'.repeat(64),subtitleStatus:'blocked' as const,timelineStatus:'unknown' as const,samples:[{atSeconds:1.25,subtitlePresent:true,font:true,fontSize:false,color:true}]}}};
 const html=renderToStaticMarkup(<WeeklyTaskRuntimeDetails executionTaskId="execution-1" loading={false} error="" workspace={withQuality}/>);
 assert.match(html,/字幕样式：未通过，需要介入/);assert.match(html,/音画同步：缺少测量，需要介入/);assert.match(html,/字号 未通过/);assert.match(html,/不代表用户已验收/);
});

test('unknown-only quality offers explicit acceptance while a measured failure does not',()=>{
 const quality={mediaSha256:'a'.repeat(64),subtitleStatus:'unknown' as const,timelineStatus:'passed' as const,samples:[]};
 const allowed=renderToStaticMarkup(<WeeklyTaskRuntimeDetails executionTaskId="execution-1" loading={false} error="" workspace={{...workspace,runId:'run',runtime:{...workspace.runtime,recovery:{...workspace.runtime.recovery,jobId:'job'},videoQuality:quality}}}/>);
 assert.match(allowed,/接受当前偏差并继续/);
 const blocked=renderToStaticMarkup(<WeeklyTaskRuntimeDetails executionTaskId="execution-1" loading={false} error="" workspace={{...workspace,runId:'run',runtime:{...workspace.runtime,recovery:{...workspace.runtime.recovery,jobId:'job'},videoQuality:{...quality,timelineStatus:'blocked' as const}}}}/>);
 assert.doesNotMatch(blocked,/接受当前偏差并继续/);
});

test('pre-run material request is shown without inventing a slot or execution',()=>{
 const html=renderToStaticMarkup(<WeeklyTaskRuntimeDetails executionTaskId="execution-1" loading={false} error="" workspace={{...workspace,runtime:{...workspace.runtime,preRunMaterialRequests:[{requestId:'req',requirement:'工厂实拍',status:'missing'}]}}}/>);
 assert.match(html,/工厂实拍/);assert.match(html,/待补交/);assert.doesNotMatch(html,/分镜 req/);
});

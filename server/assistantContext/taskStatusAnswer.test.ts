import assert from 'node:assert/strict';
import test from 'node:test';
import { answerNamedTaskStatus, namedTaskStatusReply } from './taskStatusAnswer.js';
import type { OperatingContext } from './operatingContext.js';
const context: OperatingContext = { generatedAt: '2026-10-25T00:00:00Z', selection: 'progress', sources: [{ collection: 'workflow_tasks', label: '任务', state: 'available', totalItems: 50, truncated: true,
  records: [{ sourceRef: 'workflow_tasks/private-id', facts: { title: '本地验收任务：核对出口资料', status: 'blocked', blocked_reason: '等待人工确认HS编码' } }] }] };
test('named task progress uses current limited records, with a supported conclusion and no invented history', () => {
  const answer = answerNamedTaskStatus('核对出口资料任务现在什么状态，卡在哪里？不要执行操作', context)!;
  assert.match(answer, /等待人工确认HS编码/); assert.match(answer, /总体结论：/);
  assert.ok(!answer.includes('private-id')); assert.ok(!answer.includes('未进入执行'));
  assert.doesNotMatch(answer, /不能证明|不能排除|其他进展应以|未据此推断/);
  assert.match(answer, /总体结论：请先处理/);
});

test('only a unique readable content task with a real task identity offers navigation', () => {
  const content = structuredClone(context);
  content.sources[0].collection = 'starter_social_content_tasks';
  content.sources[0].records = [{ sourceRef: 'starter_social_content_tasks/storage-id', facts: { task_id: 'socialtask_verified', status: 'plan_review', brief: { title: '产品介绍视频' } } }];
  const reply = namedTaskStatusReply('产品介绍视频任务状态', content)!;
  assert.match(reply.text, /是否前往内容创作页确认这条任务的方案？$/);
  assert.equal(reply.taskPortal?.phase, 'offered'); assert.equal(reply.taskPortal?.taskId, 'socialtask_verified');
  delete content.sources[0].records[0].facts.task_id;
  assert.equal(namedTaskStatusReply('产品介绍视频任务状态', content)?.taskPortal, undefined);
  assert.doesNotMatch(namedTaskStatusReply('产品介绍视频任务状态', content)!.text, /是否前往/);
});
test('unavailable, ambiguous, unnamed or executable requests never fabricate a unique task answer', () => {
  for (const question of ['所有任务进度', '重试核对出口资料任务', '暂停核对出口资料任务', '核对出口资料为什么失败，请分析原因']) assert.equal(answerNamedTaskStatus(question, context), null);
  assert.equal(answerNamedTaskStatus('核对出口资料任务状态', undefined), null);
  const ambiguous = structuredClone(context); ambiguous.sources[0].records.push(context.sources[0].records[0]);
  assert.match(answerNamedTaskStatus('核对出口资料任务状态', ambiguous)!, /请补充所在模块/);
});

test('unknown status does not inherit an Object prototype value and limited snapshots remain labelled', () => {
  const unknown = structuredClone(context); unknown.sources[0].records[0].facts.status = 'constructor';
  const answer = answerNamedTaskStatus('核对出口资料任务状态', unknown)!;
  assert.match(answer, /状态暂未查到/); assert.match(answer, /请打开任务核对当前状态/);
  assert.ok(!answer.includes('function Object'));
});

test('content-task read projection explains requested count without inventing completed videos', () => {
  const content = structuredClone(context);
  content.sources[0].collection = 'starter_social_content_tasks'; content.sources[0].truncated = false;
  content.sources[0].records = [{ sourceRef: 'starter_social_content_tasks/private', facts: { status: 'draft', brief: { title: '本地内容验收视频', requestedOutputCount: 3 } } }];
  const answer = answerNamedTaskStatus('查询本地内容验收视频任务状态', content)!;
  assert.match(answer, /草稿/); assert.match(answer, /计划数量：3条/);
  assert.doesNotMatch(answer, /不代表|不能证明|已完成数量/); assert.ok(!answer.includes('private'));
  const completed = answerNamedTaskStatus('本地内容验收视频任务状态，有多少条已完成？', content)!;
  assert.match(completed, /已完成数量：暂未查到/);
  assert.doesNotMatch(completed, /已完成数量：[03]条/);
  assert.match(completed, /总体结论：请在内容创作页补充制作信息/);
});

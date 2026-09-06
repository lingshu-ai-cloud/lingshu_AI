import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { buildDeliveryResources, draftDelivery, projectDelivery } from './deliveryResources.js';
import { fallbackDelivery, filterDeliveries, isDeliveryStale, safeDeliveryUrl } from '../../src/lib/delivery.js';
import type { WorkflowTask } from '../../src/lib/digitalEmployees.js';
import { store } from '../storage/index.js';

const task = (key: string, status = 'running'): WorkflowTask => ({ id: key, run_id: 'run-a', task_key: key, title: key, description: '验收要求', status, sequence: 1, priority: 'normal', requires_approval: false, depends_on: [], output: {}, blocked_reason: '', owner_id: '', updated_at: '2026-09-04T00:00:00Z', agent_role: 'content', kind: 'production', business_refs: [] });
const tasks = [task('content_mode_routing', 'succeeded'), task('content_production'), task('content_quality_gate', 'pending')];
const ready = projectDelivery({ id: 'project-1', title: '防水演示', updated_at: '2026-09-04T01:00:00Z', spec: { workflowRunId: 'run-a', workflowTaskId: 'content_production', script: '真实脚本', automation: { stage: 'completed', quality: { passed: true }, completedAt: '2026-09-04T01:00:00Z' } } }, tasks, '/api/video.mp4');
assert.equal(ready.column, 'human', 'machine-completed project waits for independent content acceptance');
assert.equal(ready.contentApproval?.approved, false);
assert.equal(ready.link?.businessRef.entityId, 'project-1');
assert.equal(ready.link?.taskId, 'content_production');
assert.equal(ready.effect, '尚未发布');
const missing = projectDelivery({ id: 'missing', spec: { automation: { stage: 'completed', quality: { passed: true } } } }, tasks, '');
assert.equal(missing.column, 'human', 'missing file must not be delivered');
assert.equal(missing.exception, true);
const unreviewed = projectDelivery({ id: 'unreviewed', spec: { automation: { stage: 'quality', quality: { passed: false } } } }, tasks, '/video.mp4');
assert.notEqual(unreviewed.column, 'done');
const drafts = [task('followup_batch_draft', 'succeeded'), task('followup_batch_approval', 'waiting_approval')];
const draft = draftDelivery({ id: 'alice-draft', customer_name: 'Alice', customer_id: 'alice', draft_body: '交期需要确认', status: 'draft', draft_version: 2 }, { id: 'batch-a', name: '本周客户' }, drafts);
assert.equal(draft.column, 'human'); assert.equal(draft.effect, '尚未发送');
assert.equal(draft.link?.businessRef.entityId, 'alice'); assert.equal(draft.link?.businessRef.itemId, 'alice-draft');
assert.equal(draft.artifacts[0].version, 'v2');
const approved = draftDelivery({ id: 'approved', draft_body: '已核对回复', status: 'failed', content_hash: createHash('sha256').update(JSON.stringify('已核对回复')).digest('hex'), approved_at: '2026-09-04', last_error: '发送失败' }, { id: 'batch-a', status: 'approved', version: 1, approved_version: 1, approval_id: 'approval-a' }, drafts);
assert.equal(approved.column, 'done', 'a later send failure must not revoke the approved draft delivery');
assert.equal(approved.effect, '尚未发送');
const changedDraft = draftDelivery({ id: 'changed', draft_body: '修改后的交期', status: 'approved', approved_at: '2026-09-04', content_hash: 'old-hash' }, { id: 'batch-a', status: 'approved', version: 2, approved_version: 1, approval_id: 'old-approval' }, drafts);
assert.equal(changedDraft.column, 'human', 'stale approval must not approve a new batch or changed draft');
assert.match(changedDraft.reason, /重新审核/);
for (const status of ['skipped', 'cancelled', 'succeeded', 'completed', 'unknown']) assert.notEqual(fallbackDelivery(task('other', status), '目标').column, 'done');
assert.equal(safeDeliveryUrl('javascript:alert(1)'), ''); assert.equal(safeDeliveryUrl('//untrusted.test'), '');
assert.equal(isDeliveryStale({ ...ready, column: 'active', updatedAt: '2026-09-04T00:00:00Z' }, Date.parse('2026-09-04T01:00:00Z')), true);
assert.equal(filterDeliveries([ready, draft], { query: 'Alice', subject: 'all', kind: 'all', period: 'all', exceptions: false, now: Date.now() })[0].id, draft.id);

const originalGet = store.getById, originalList = store.list;
try {
  store.getById = async (_collection, id) => ({ id, tenant_id: 'another-tenant', spec: {} }) as any;
  store.list = async () => ({ items: [], page: 1, perPage: 200, totalItems: 0, totalPages: 1 });
  const scoped = await buildDeliveryResources('tenant-a', [{ ...tasks[1], business_refs: [{ type: 'studio_project', id: 'foreign' }] }], '目标');
  assert.ok(scoped.every(card => card.id !== 'studio_project:foreign'), 'foreign records cannot be exposed');
  assert.ok(scoped.every(card => card.column !== 'done'));
  const preparations = await buildDeliveryResources('tenant-a', tasks, '新品推广');
  assert.equal(preparations.length, 1, 'internal content steps become one preparation card before projects exist');
  assert.equal(preparations[0].taskIds.length, 3);
  const queried: string[] = [];
  store.list = async (collection: string) => { queried.push(collection); return { items: [], page: 1, perPage: 200, totalItems: 0, totalPages: 1 }; };
  await buildDeliveryResources('tenant-a', drafts, '客服目标');
  assert.ok(!queried.includes('studio_projects'), 'customer workspace must not scan video projects');
  const internal = await buildDeliveryResources('tenant-a', [{ ...task('goal_decomposition', 'succeeded'), output: { objective: '获得询盘', target: 5 } }], '经营目标');
  assert.equal(internal[0].column, 'done', 'real internal business results can be delivered without an external file');
  assert.match(internal[0].artifacts[0].text!, /获得询盘/);
} finally { store.getById = originalGet; store.list = originalList; }
console.log('Delivery resource behavior tests passed');

const progressing = projectDelivery({ id: 'progressing', spec: { workflowTaskId: tasks[1].id, script: '真实已生成脚本', automation: { status: 'queued', stage: 'voice_subtitles' } } }, tasks, '');
assert.equal(progressing.column, 'active', 'persisted production progress overrides a stale queued marker');

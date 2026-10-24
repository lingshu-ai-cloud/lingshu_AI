import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { VideoCreationPlan } from '../../../shared/contracts/videoCreationPlan';
import type { ContentQueueItem, DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import { buildEmployeeExecutionRows } from './EmployeeExecutionView';

const item = (contentId: string, patch: Partial<ContentQueueItem> = {}): ContentQueueItem => ({
  id: `queue-${contentId}`, contentId, origin: 'weekly_plan', socialContentTaskId: '',
  lineage: { goalId: 'goal', planId: 'plan' }, steps: [], status: 'producing', projectIds: [], reason: '', ...patch,
} as ContentQueueItem);
const overview = (items: ContentQueueItem[], plans: Partial<VideoCreationPlan>[] = []): DigitalEmployeeOverview => ({
  goal: { id: 'goal' }, plan: { id: 'plan', businessPackage: { tasks: [{ templateId: 'production', videoPlans: plans }] } },
  run: { id: 'run', goal_id: 'goal', plan_id: 'plan' }, tasks: [], contentQueue: { sourceStatus: 'available', items },
} as unknown as DigitalEmployeeOverview);

test('execution rows exclude manual and foreign-plan content before grouping', () => {
  const data = overview([item('current'), item('manual', { origin: 'manual' }), item('foreign', { lineage: { goalId: 'goal', planId: 'older-plan' } as ContentQueueItem['lineage'] })]);
  assert.deepEqual(buildEmployeeExecutionRows(data).map(row => row.id), ['current']);
});

test('only verified master identities group platform adaptations; titles do not', () => {
  const data = overview([item('adaptation'), item('master'), item('unrelated', { title: 'Same title' }), item('another', { title: 'Same title' })], [
    { contentId: 'master', productionRole: 'master', contentFamilyId: 'family' },
    { contentId: 'adaptation', productionRole: 'platform_adaptation', masterContentId: 'master', contentFamilyId: 'family' },
  ]);
  const rows = buildEmployeeExecutionRows(data);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].id, 'master');
  assert.equal(rows[0].item.contentId, 'master');
  assert.equal(rows[0].items.length, 2);
});

test('technical blocked does not become a human task; explicit review does', () => {
  const rows = buildEmployeeExecutionRows(overview([item('technical', { status: 'blocked', reason: 'Provider recovering' }), item('review', { status: 'waiting_review' })]));
  assert.equal(rows[0].needsHuman, false);
  assert.equal(rows[1].needsHuman, true);
});

test('foreign run receipts cannot claim completion or current human action', () => {
  const data = overview([item('video', { socialContentTaskId: 'video', status: 'waiting_review' })]);
  data.run!.plan_id = 'foreign-plan';
  const row = buildEmployeeExecutionRows(data)[0];
  assert.equal(row.needsHuman, false);
  assert.equal(row.progress.status, 'unavailable');
  assert.ok(row.progress.stages.every(stage => stage.status === 'unavailable' && stage.evidence.length === 0));
});

test('confirmed weekly video plans remain visible before execution tasks exist', () => {
  const data = overview([], [{ contentId: 'planned-video', productionRole: 'master', theme: 'Planned story', productName: 'Product', platform: 'tiktok' }]);
  const [row] = buildEmployeeExecutionRows(data);
  assert.equal(row.id, 'planned-video');
  assert.equal(row.item.title, 'Planned story');
  assert.equal(row.progress.statusLabel, '尚未派生执行任务');
  assert.equal(row.progress.taskId, null);
  assert.equal(row.needsHuman, false);
  assert.equal('taskId' in row.item, false, 'a display row never creates an execution task');
});

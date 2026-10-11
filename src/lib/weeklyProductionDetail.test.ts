import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DigitalEmployeeOverview } from './digitalEmployees';
import { weeklyProductionStudioLinks } from './weeklyProductionDetail';
import type { WeeklyContentProgressProject } from './weeklyContentProgress';

const overview = () => ({
  goal: { id: 'goal' }, plan: { id: 'plan', businessPackage: { tasks: [{ templateId: 'production', videoPlans: [
    { contentId: 'master', productionRole: 'master', contentFamilyId: 'family', productId: 'product', route: 'material' },
    { contentId: 'variant', productionRole: 'platform_adaptation', masterContentId: 'master', contentFamilyId: 'family', productId: 'product' },
  ] }] } },
  run: { id: 'run', goal_id: 'goal', plan_id: 'plan' }, tasks: [{ id: 'task', run_id: 'run', task_key: 'content_production', status: 'running', business_refs: [{ type: 'studio_project', id: 'unrelated-first-project' }] }],
  contentQueue: { items: [{ id: 'queue', contentId: 'master', origin: 'weekly_plan', lineage: { goalId: 'goal', planId: 'plan' }, taskId: 'task', orderId: 'order', projectIds: ['project', 'translated'], steps: [], status: 'producing', stage: 'material_match', reason: '' }] },
}) as unknown as DigitalEmployeeOverview;
const project = (id = 'project'): WeeklyContentProgressProject => ({ id, spec: {
  workflowRunId: 'run', workflowTaskId: 'task', contentOrderId: 'order::en', language: 'en',
  contentOrder: { lineage: { goalId: 'goal', planId: 'plan' } }, automation: { managedBy: 'digital_employee', stage: 'material_match' },
} });

test('studio link opens only selected verified content project, retaining return attribution', () => {
  const result = weeklyProductionStudioLinks(overview(), 'master', [project(), project('unrelated-first-project')]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0]!.link, {
    page: 'smartAssets', view: 'create', studioPanel: 'projects', runId: 'run', taskId: 'task',
    businessRef: { taskKey: 'content_production', entityId: 'project', deliveryId: 'studio_project:project', contentId: 'master', resources: [{ type: 'studio_project', id: 'project' }], businessDomain: undefined, capabilityKey: undefined, taskVersion: undefined, correctionVersion: undefined },
  });
});

test('adaptation uses verified master and multiple versions stay explicit choices', () => {
  const data = overview(); const before = JSON.stringify(data);
  const result = weeklyProductionStudioLinks(data, 'variant', [project(), project('translated'), project()]);
  assert.deepEqual(result.map(value => value.projectId), ['project', 'translated']);
  assert.ok(result.every(value => value.link.businessRef.contentId === 'variant'));
  assert.equal(JSON.stringify(data), before);
  assert.deepEqual(weeklyProductionStudioLinks(data, 'unknown', [project()]), []);
});

test('old or foreign project, order, run, task and plan cannot be navigated to', () => {
  for (const patch of [
    { workflowRunId: 'old-run' }, { workflowTaskId: 'other-task' }, { contentOrderId: 'other-order' },
    { contentOrder: { lineage: { goalId: 'other' } } }, { contentOrder: { lineage: { planId: 'other' } } },
    { automation: { managedBy: 'other', stage: 'material_match' } }, { automation: { managedBy: 'digital_employee', stage: 'superseded' } },
  ]) {
    const candidate = project(); candidate.spec = { ...candidate.spec as object, ...patch };
    assert.deepEqual(weeklyProductionStudioLinks(overview(), 'master', [candidate]), []);
  }
  for (const change of [
    (data: DigitalEmployeeOverview) => { data.run!.plan_id = 'old-plan'; },
    (data: DigitalEmployeeOverview) => { data.contentQueue!.items[0]!.lineage.goalId = 'foreign'; },
    (data: DigitalEmployeeOverview) => { data.contentQueue!.items.push({ ...data.contentQueue!.items[0]!, id: 'ambiguous' }); },
    (data: DigitalEmployeeOverview) => { data.tasks[0]!.run_id = 'old-run'; },
  ]) { const data = overview(); change(data); assert.deepEqual(weeklyProductionStudioLinks(data, 'master', [project()]), []); }
});

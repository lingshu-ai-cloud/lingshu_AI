import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTaskDeepLink, digitalEmployeeConfigFingerprint, planConfigForDisplay, type DigitalEmployeeConfig, type WorkflowTask } from './digitalEmployees';

test('task deep links preserve exact Studio task attribution and fixed publishing destination', () => {
  const task = {
    id: 'task-a', task_key: 'content_release_approval', kind: 'production',
    business_refs: [{ type: 'studio_project', id: 'project-a' }],
    task_version: 3, correction_version: 1,
  } as unknown as WorkflowTask;
  const link = buildTaskDeepLink(task, undefined, 'run-a');
  assert.equal(link.page, 'smartAssets');
  assert.equal(link.view, 'publish');
  assert.equal(link.businessRef.entityId, 'project-a');
  assert.equal(link.businessRef.deliveryId, 'studio_project:project-a');
  assert.equal(link.businessRef.taskVersion, 3);
});

test('legacy config display remains fail-closed and fingerprint follows source content', () => {
  const current = {
    companyName: 'Current', team: ['content'], publishingTargets: [{ platform: 'facebook', accountId: 'a', accountLabel: 'A' }],
    enabledWorkflows: ['content_publish'], constraints: [], allowRealPublishing: true, allowRealCustomerMessages: true,
  } as unknown as DigitalEmployeeConfig;
  const legacy = { ...current, companyName: 'Legacy', allowRealPublishing: undefined, allowRealCustomerMessages: undefined } as unknown as DigitalEmployeeConfig;
  const display = planConfigForDisplay(legacy, current);
  assert.equal(display.companyName, 'Legacy');
  assert.equal(display.allowRealPublishing, false);
  assert.equal(display.allowRealCustomerMessages, false);
  assert.equal(digitalEmployeeConfigFingerprint(current), digitalEmployeeConfigFingerprint({ ...current }));
  assert.notEqual(digitalEmployeeConfigFingerprint(current), digitalEmployeeConfigFingerprint({ ...current, companyName: 'Changed' }));
});

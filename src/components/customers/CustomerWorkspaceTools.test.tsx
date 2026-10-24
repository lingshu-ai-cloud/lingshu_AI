import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { customerWorkspaceTasks } from './customerWorkspaceTasks.js';
import { buildTaskDeepLink, type DigitalEmployeeOverview } from '../../lib/digitalEmployees.js';
import { OrderHistoryWidget } from './widgets/OrderHistoryWidget.js';
import { BasicInfoWidget } from './widgets/BasicInfoWidget.js';
import { createMockCustomers } from '../../mocks/customerProfiles.js';

test('workspace task entry preserves the original run, approval version and resource references', () => {
  const task = { id: 'approval-task', run_id: 'original-run', agent_role: 'customer', task_key: 'followup_batch_approval', title: '原批次审批', task_version: 7, correction_version: 2, output: {}, business_refs: [{ type: 'followup_batch', id: 'original-batch' }] };
  const overview = { run: { id: 'original-run' }, tasks: [task,
    { ...task, id: 'foreign-run-task', run_id: 'another-run' }, { ...task, id: 'unrelated-task', agent_role: 'content' }, { ...task, id: 'other-capability', task_key: 'platform_publish' },
  ] } as unknown as DigitalEmployeeOverview;
  const before = structuredClone(overview), tasks = customerWorkspaceTasks(overview);
  assert.deepEqual(tasks.map(t => t.id), ['approval-task']);
  const link = buildTaskDeepLink(tasks[0]!, undefined, overview.run!.id);
  assert.equal(link.page, 'conversion'); assert.equal(link.runId, 'original-run'); assert.equal(link.taskId, 'approval-task');
  assert.equal(link.businessRef.taskVersion, 7); assert.deepEqual(link.businessRef.resources, task.business_refs);
  assert.deepEqual(overview, before); assert.deepEqual(customerWorkspaceTasks(null), []);
});

test('restored order panel keeps the existing WhatsApp write boundary and never offers writes for archived or simulated customers', () => {
  const customer = createMockCustomers('workspace-test')[0]!;
  const render = (patch: Partial<typeof customer>) => renderToStaticMarkup(<OrderHistoryWidget customer={{ ...customer, ...patch }} />);
  assert.match(render({ source: 'whatsapp', isReal: true, isMock: false }), /添加订单/);
  assert.doesNotMatch(render({ source: 'instagram', isReal: true, isMock: false }), /添加订单/);
  assert.doesNotMatch(render({ source: 'whatsapp', isReal: true, isMock: false, isHistorical: true }), /添加订单/);
  assert.doesNotMatch(render({ source: 'whatsapp', isReal: true, isMock: true }), /添加订单/);
});

test('restored profile controls do not pretend to save through an absent mutation adapter', () => {
  const customer = createMockCustomers('workspace-test')[0]!;
  const markup = renderToStaticMarkup(<BasicInfoWidget customer={customer} />);
  const languageButton = markup.match(/<button[^>]*title="手动指定回复语言"[^>]*>/)?.[0];
  assert.ok(languageButton); assert.match(languageButton, /disabled/);
});

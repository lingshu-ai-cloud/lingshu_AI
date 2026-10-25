import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../socialPrograms/weeklyContentTemplates.fixture.js';
import { createStarter198Repository } from './repository.js';
import { recordAssistantStartFailure, socialAssistantAdmission } from './socialContentAssistantStart.js';
import { SocialContentWorkflowError } from './socialContentValidation.js';

test('queue acceptance requires the matching persisted receipt even before a run is allocated', () => {
  const row={id:'row',run_id:'',orchestrator_item_id:'queue',brief:{_executionQueueReceipt:{queueItemId:'queue',disposition:'queued',runId:null}}};
  assert.equal(socialAssistantAdmission(row).executionAdmission?.state,'queued');
  assert.deepEqual(socialAssistantAdmission({...row,orchestrator_item_id:'other'}),{});
  assert.deepEqual(socialAssistantAdmission({...row,brief:{_executionQueueReceipt:{queueItemId:'queue',disposition:'requires_manual_production'}}}),{});
});

test('failed admission remains on its task; an uncertain frozen dispatch is left to the existing outbox', async () => {
  const f=await fixture();
  try {
    const repository=createStarter198Repository(f.store),row=f.tables.starter_social_content_tasks![0]!;
    row.run_id='';row.status='draft';row.version='1';row.brief={};
    const input={repository,tenantId:'t',userId:'operator',taskId:'content',now:new Date('2026-10-26T00:00:00Z'),error:new SocialContentWorkflowError('social_content_task_inputs_incomplete',409)};
    await recordAssistantStartFailure(input);
    assert.equal(row.status,'attention');assert.equal(row.version,'2');
    assert.equal(socialAssistantAdmission(row).executionAdmission?.state,'blocked');
    assert.equal(socialAssistantAdmission(row).executionAdmission?.reason,'social_content_task_inputs_incomplete');
    row.status='plan_review';row.content_order={dispatch:{commandId:'original-dispatch'}};
    const frozen=structuredClone(row);
    await recordAssistantStartFailure({...input,error:Error('queue acknowledgement lost')});
    assert.deepEqual(row,frozen,'an unknown dispatch outcome cannot be relabelled failed or automatically retried through a new command');
  } finally { await f.cleanup(); }
});

import assert from 'node:assert/strict';
import {
  DigitalEmployeeApprovalDecisionError,
  type DecideDigitalEmployeeApprovalInput,
} from '../digitalEmployees/approvalDecision.js';
import { createStarter198ApprovalDecisionPort } from './approvalDecision.js';
import { Starter198RuntimePortError } from './runtimePorts.js';

let received: DecideDigitalEmployeeApprovalInput | undefined;
const port = createStarter198ApprovalDecisionPort(async input => {
  received = input;
  return {
    state: 'decided',
    decision: input.decision,
    runId: 'run-1',
    taskId: 'task-1',
    publishingEntries: [],
  };
});

await port.decide({
  tenantId: 'tenant-1',
  userId: 'owner-1',
  approvalId: 'approval-1',
  expectedSubjectVersion: '7',
  decision: 'approved',
  note: 'approved in starter',
});
assert.deepEqual(received, {
  tenantId: 'tenant-1',
  userId: 'owner-1',
  approvalId: 'approval-1',
  expectedSubjectVersion: '7',
  decision: 'approved',
  note: 'approved in starter',
  policy: 'starter_198',
});

const failing = createStarter198ApprovalDecisionPort(async () => {
  throw new DigitalEmployeeApprovalDecisionError('approval_subject_changed', 409);
});
await assert.rejects(
  failing.decide({
    tenantId: 'tenant-1', userId: 'owner-1', approvalId: 'approval-1',
    expectedSubjectVersion: '6', decision: 'rejected', note: '',
  }),
  error => error instanceof Starter198RuntimePortError
    && error.code === 'approval_subject_changed'
    && error.status === 409,
);

console.log('Starter 198 approval port delegates to the canonical application service and preserves typed failures');

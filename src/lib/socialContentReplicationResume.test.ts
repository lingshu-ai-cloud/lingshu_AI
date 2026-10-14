import assert from 'node:assert/strict';
import test from 'node:test';
import { replicationResumeStep } from './socialContentReplicationResume';

test('replication project resumes from the server-owned production stage', () => {
  assert.equal(replicationResumeStep({ spec: { automation: { stage: 'script', status: 'processing' } } }), null);
  assert.equal(replicationResumeStep({ spec: { automation: { stage: 'material_match', status: 'processing' } } }), 2);
  assert.equal(replicationResumeStep({ spec: { automation: { stage: 'blocked', resumeStage: 'material_match' } } }), 2);
  assert.equal(replicationResumeStep({ spec: { automation: { stage: 'rendering', status: 'processing' } } }), 3);
  assert.equal(replicationResumeStep({ spec: { automation: { stage: 'completed', status: 'completed' } } }), 3);
});

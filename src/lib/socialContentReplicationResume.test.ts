import assert from 'node:assert/strict';
import test from 'node:test';
import { hasCompiledReplicationStoryboard, replicationResumeStep } from './socialContentReplicationResume';

test('replication project resumes from the server-owned production stage', () => {
  const compiled = { script: '[0-3s]\n画面：产品展示\n口播：你好' };
  assert.equal(replicationResumeStep({ spec: { ...compiled, automation: { stage: 'script', status: 'processing' } } }), null);
  assert.equal(replicationResumeStep({ spec: { ...compiled, automation: { stage: 'material_match', status: 'processing' } } }), 2);
  assert.equal(replicationResumeStep({ spec: { ...compiled, automation: { stage: 'blocked', resumeStage: 'material_match' } } }), 2);
  assert.equal(replicationResumeStep({ spec: { ...compiled, automation: { stage: 'rendering', status: 'processing' } } }), 3);
  assert.equal(replicationResumeStep({ spec: { ...compiled, automation: { stage: 'completed', status: 'completed' } } }), 3);
  assert.equal(replicationResumeStep({ spec: { automation: { stage: 'rendering', status: 'processing' } } }), null,
    'a downstream runtime stage must not open an empty preview without compiled storyboard evidence');
  assert.equal(hasCompiledReplicationStoryboard({ script: '普通口播，没有分镜时间线' }), false);
});

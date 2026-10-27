import assert from 'node:assert/strict';
import test from 'node:test';
import type { SocialImageCreationTask } from '../../../shared/contracts/socialImageCreation';
import { socialImageApi } from '../../lib/socialImageApi';
import { saveNaturalLanguageRegeneration } from './socialImageNaturalLanguageRepair';

test('natural-language change saves one pending repair on the latest image without calling a paid endpoint', async () => {
  const original = socialImageApi.updateTask;
  const calls: Array<Partial<SocialImageCreationTask>> = [];
  socialImageApi.updateTask = async (task, patch) => { calls.push(patch); return { ok: true, task: { ...task, ...patch } }; };
  try {
    const task = { id: 'image-1', repairInstructions: [], outputs: [
      { id: 'old', role: 'single', version: 1, state: 'superseded', mediaUrl: '/old.png', qualityChecks: [] },
      { id: 'latest', role: 'single', version: 2, state: 'repair_required', mediaUrl: '/latest.png', qualityChecks: [] },
    ] } as unknown as SocialImageCreationTask;
    await saveNaturalLanguageRegeneration(task, '  瓶子向左一些  ');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.repairInstructions?.[0]?.outputNodeId, 'latest');
    assert.equal(calls[0]?.repairInstructions?.[0]?.instruction, '用户要求：瓶子向左一些');
    assert.equal(calls[0]?.outputs?.[0]?.state, 'superseded');
    assert.equal(calls[0]?.status, 'planned');
    assert.equal(calls[0]?.step, 'generate');
  } finally { socialImageApi.updateTask = original; }
});

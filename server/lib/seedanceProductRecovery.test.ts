import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StoryboardAigcProjectBudget } from './storyboardAigcProjectBudget.js';
import { SeedanceProductRecovery } from './seedanceProductRecovery.js';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seedance-recovery-'));
try {
  const budget = new StoryboardAigcProjectBudget(path.join(root, 'budget'), () => 10);
  const scope = { tenantId: 'tenant', projectId: 'project', shotId: 'shot', operationId: 'video-one', inputFingerprint: 'frozen-v1' };
  await budget.reserve({ ...scope, stage: 'video', estimatedCostCny: 6, inputFingerprint: scope.inputFingerprint });
  let recovery = new SeedanceProductRecovery(budget, path.join(root, 'locks'));
  const snapshot = { model: 'doubao-seedance', baseUrl: 'https://ark.example/api/v3', firstFrameMaterialId: 'frame', firstFrameFingerprint: 'frame-v1' };
  await recovery.recordPrepared(scope, snapshot);
  const requests: string[] = [];
  const config = { ...snapshot, apiKey: 'test', transport: (async (url, init) => {
    requests.push(`${init?.method}:${url}`);
    return new Response(JSON.stringify({ id: 'cgt-original', status: 'succeeded', content: { video_url: 'https://output.example/video.mp4' } }));
  }) as typeof fetch };
  assert.deepEqual(await recovery.recover(scope, config), { state: 'reconciliation_required', reason: 'missing_task_id' });
  assert.equal(requests.length, 0);
  await assert.rejects(recovery.recordPrepared(scope, snapshot), /原请求已存在/);
  await recovery.recordAccepted(scope, 'cgt-original');
  recovery = new SeedanceProductRecovery(new StoryboardAigcProjectBudget(path.join(root, 'budget'), () => 10), path.join(root, 'locks'));
  await budget.mark(scope.tenantId, scope.projectId, scope.operationId, 'uncertain');
  assert.equal((await recovery.recover(scope, config)).state, 'ready');
  assert.equal(requests.length, 1);
  assert.match(requests[0], /^GET:.*cgt-original$/);
  await assert.rejects(recovery.recover({ ...scope, tenantId: 'foreign' }, config), /原镜头输入不一致/);
  await assert.rejects(recovery.recover({ ...scope, inputFingerprint: 'changed' }, config), /原镜头输入不一致/);
  await assert.rejects(recovery.recordAccepted(scope, 'replacement'), /禁止替换/);
  await assert.rejects(recovery.recover(scope, { ...config, transport: (async () => new Response('', { status: 503 })) as typeof fetch }), /503/);
  assert.equal((await budget.status(scope.tenantId, scope.projectId)).usedCny, 6);
  await recovery.recordCompleted(scope, 'material-original');
  assert.equal((await recovery.recover(scope, config)).state, 'completed');
  assert.equal(requests.length, 1, 'completed media avoids another supplier query');
  assert.equal((await budget.status(scope.tenantId, scope.projectId)).usedCny, 6);
  console.log('seedanceProductRecovery: durable GET recovery, unknown, isolation and completed replay passed');
} finally { fs.rmSync(root, { recursive: true, force: true }); }

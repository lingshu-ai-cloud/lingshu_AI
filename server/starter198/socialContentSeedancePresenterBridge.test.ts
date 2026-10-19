import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSocialSeedancePresenterBridge, type SeedancePresenterBridgeDependencies } from './socialContentSeedancePresenterBridge.js';

const sha = (x: string) => createHash('sha256').update(x).digest('hex');
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'presenter-seedance-'));
  const firstFrame = path.join(directory, 'frame.jpg'); await fs.writeFile(firstFrame, 'frame');
  const tables: Record<string, any[]> = {};
  const store: any = {
    list: async (table: string, options: any) => { const items = (tables[table] ?? []).filter(row => Object.entries(options.where).every(([key, value]) => row[key] === value)); return { items, totalItems: items.length }; },
    create: async (table: string, row: any) => { const item = { ...row, id: `${table}-${(tables[table] ?? []).length}` }; (tables[table] ??= []).push(item); return item; },
    getById: async (table: string, id: string) => tables[table]?.find(row => row.id === id),
    update: async (table: string, id: string, fields: any) => { const row = tables[table]?.find(item => item.id === id); if (!row) return null; Object.assign(row, fields); return row; },
    delete: async (table: string, id: string) => { const rows = tables[table] ?? []; const index = rows.findIndex(row => row.id === id); if (index < 0) return false; rows.splice(index, 1); return true; },
  };
  let posts = 0, paidChecks = 0;
  const deps: SeedancePresenterBridgeDependencies = {
    store, model: 'controlled-seedance', apiKey: 'controlled-test-only', maximumCostCny: 2,
    resolvePresenter: async () => null, authorizeBudget: async () => ({ allowed: true, reservationRef: 'whole-film-reservation' }),
    assertCurrent: async () => {},
    prepareInputs: async () => ({ firstFrameUrl: 'https://controlled/frame.jpg', firstFrameSha256: sha('frame'), motionGuideUrl: 'https://controlled/motion.mp4', motionGuideSourceSha256: sha('source'), motionGuideSha256: sha('anonymous'), identityRemoved: true, motionOnly: true }),
    beforeSubmit: async (_input, body) => { paidChecks++; assert.equal(body.generate_audio, false); },
    verifyOutput: async () => ({ passed: true, durationSeconds: 3, evidenceRefs: ['actual-qa-receipt'], actualCostCny: 1 }),
    maxPolls: 1,
    transport: async (url: any, init?: any) => {
      if (init?.method === 'POST') { posts++; return new Response(JSON.stringify({ id: 'provider-task-1' })); }
      if (String(url).includes('/tasks/')) return new Response(JSON.stringify({ status: 'succeeded', content: { video_url: 'https://controlled/result.mp4' } }));
      return new Response('real-controlled-video-bytes');
    },
  };
  const request: any = { tenantId: 'tenant-a', taskId: 'task-a', shotId: 'shot-a', idempotencyKey: 'request-a', reservationRef: 'whole-film-reservation',
    presenter: { providerId: 'seedance', authorized: true, authorizationRef: 'rights', consentRef: 'consent' },
    approvedFirstFrame: { localPath: firstFrame, sha256: sha('frame'), approvalRecordHash: sha('approval'), presenterGroupContractHash: sha('group') },
    script: 'visual motion', outputDirectory: directory, maximumCostCny: 2,
    visualControl: { product: { required: false }, timing: { durationSeconds: 3 }, requiredCapabilities: ['reference_motion', 'timing_control'] },
  };
  return { deps, request, posts: () => posts, paidChecks: () => paidChecks };
}
test('actual motion submission is funded, downloaded, inspected and recovered without duplicate POST', async () => {
  const f = await fixture(), bridge = createSocialSeedancePresenterBridge(f.deps);
  const result = await bridge.execute(f.request); assert.equal(result.status, 'completed');
  const recovered = await bridge.recoverExisting!({ ...f.request, recoveryOnly: true });
  assert.equal(recovered?.status, 'completed'); assert.equal(f.posts(), 1); assert.equal(f.paidChecks(), 1);
});
test('unknown submission never blindly retries even when provider omitted task ID', async () => {
  const f = await fixture(); f.deps.transport = async () => new Response('{}');
  const bridge = createSocialSeedancePresenterBridge(f.deps);
  await assert.rejects(bridge.execute(f.request), /provider_task_id_missing/);
  await assert.rejects(bridge.execute(f.request), /submission_unknown_do_not_resubmit/);
  assert.equal(f.paidChecks(), 1);
});
test('precise speech and physical contact fail before any paid submission; failed QA is not a delivery', async () => {
  const f = await fixture(), bridge = createSocialSeedancePresenterBridge(f.deps);
  await assert.rejects(bridge.execute({ ...f.request, visualControl: { ...f.request.visualControl, requiredCapabilities: ['scripted_speech'] } }), /precise_speech_capability_unverified/);
  await assert.rejects(bridge.execute({ ...f.request, visualControl: { ...f.request.visualControl, product: { required: true } } }), /physical_product_contact_unsupported/);
  assert.equal(f.posts(), 0);
  f.deps.verifyOutput = async () => ({ passed: false, durationSeconds: 3, evidenceRefs: ['failed-qa'] });
  await assert.rejects(bridge.execute(f.request), /dynamic_quality_failed/);
});

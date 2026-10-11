import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./studio.ts', import.meta.url), 'utf8');
const route = (name: string) => source.split(`studioRouter.post('${name}', async (req, res) => {`)[1]!.split("studioRouter.post('")[0]!;
test('all storyboard routes recover old native receipts before any new budget or demo quota admission', () => {
  for (const [name, marker, fallback] of [
    ['/storyboard-first-frame', 'if (await replyExistingFrame(existingFrameOperation)) return;', 'await replyExistingFrame(admission.entry); return;'],
    ['/storyboard-action-video', 'if (await replyExistingAction(existingActionOperation)) return;', 'await replyExistingAction(reserved.entry); return;'],
    ['/seedance-video', 'if (await replyExistingVideo(existingVideoOperation)) return;', 'await replyExistingVideo(reserved.entry); return;'],
  ]) {
    const body = route(name);
    assert.ok(body.indexOf(marker) > 0, name);
    assert.ok(body.indexOf(marker) < body.indexOf('studioAigcBudgetPreviewForSpec('), `${name}: replay must precede remaining-budget planning`);
    assert.ok(body.indexOf(marker) < body.indexOf('consumeDemoQuota('), `${name}: a receipt query must not consume a new-call quota`);
    assert.ok(body.includes(fallback), `${name}: reserve-time races must use the same recovery validation`);
  }
  assert.ok(route('/storyboard-action-video').indexOf('replyExistingAction(existingActionOperation)')
    < route('/storyboard-action-video').indexOf('!isSeedanceVideoEnabled()'));
  assert.ok(route('/seedance-video').indexOf('replyExistingVideo(existingVideoOperation)')
    < route('/seedance-video').indexOf('!isSeedanceVideoEnabled()'));
});
test('saved output recovery checks current bindings and bytes, with legacy source-plan image support', () => {
  const helper = source.split('async function storyboardReplayVideoResponse(')[1]!.split('// POST /studio/storyboard-first-frame')[0]!;
  for (const evidence of ['p.projectId !== input.projectId', 'p.shotId !== input.shotId', 'p.firstFrameMaterialId !== input.firstFrame.id',
    'p.firstFrameFingerprint !== input.firstFrameFingerprint', 'p.resolution !== input.resolution', 'p.providerModel !== input.model',
    'storyboardKbAssignmentIssuesForSpec(', 'validateReplicationVideo(', 'storyboardReplayFrameBytesCurrent(']) assert.ok(helper.includes(evidence), evidence);
  assert.ok(!helper.includes('automationStoryboardAssignmentIssues('), 'receipt recovery must allow a draft to reach QA without granting assignment admission');
  const context = source.split('export async function studioAigcBudgetContext(')[1]!.split('async function storyboardKbAssignmentIssuesForSpec')[0]!;
  assert.ok(context.includes('Object.entries(spec.storyboardSourcePlans || {})'));
  assert.ok(context.includes('p.shotId !== state.slotId'));
  assert.ok(context.includes('asset.id !== sourceUrl'));
  assert.ok(context.includes('verifiedFirstFrameContentSha256ByMaterialId[frame.id] = hash'));
  assert.ok(route('/storyboard-first-frame').includes('planned.firstFrameCallCount !== frameCallCount'));
});

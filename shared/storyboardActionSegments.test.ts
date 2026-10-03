import assert from 'node:assert/strict';
import { planStoryboardActionSegments } from './storyboardActionSegments';
import { compileStoryboardShotSpec } from './storyboardShotSpec';

const capability = { minDurationSeconds: 4, maxDurationSeconds: 15, integerDurationSeconds: true, supportsFirstFrame: true, supportsEndFrame: false };
function shot(duration: number, beats: string[]) {
  return compileStoryboardShotSpec({
    shotId: `usage-${duration}`, mode: 'free_creation', scene: 'usage', description: '在家安装吊灯', ratio: '9:16',
    startSeconds: 0, endSeconds: duration,
    assets: [{ role: 'product', id: 'lamp', version: '1', source: 'knowledge_base' }],
    action: { startState: '手持灯具，安装位为空', beats, endState: '灯具已经固定，双手离开', evidence: 'confirmed_storyboard' },
  });
}

const simple = planStoryboardActionSegments({ shot: shot(4, ['对准安装位']), capability, firstFrameAssetId: 'frame-1' });
assert.equal(simple.status, 'planned');
if (simple.status === 'planned') {
  assert.equal(simple.segments.length, 1);
  assert.equal(simple.segments[0]!.startImageAssetId, 'frame-1');
  assert.equal(simple.readyForSubmission, true);
  assert.equal(simple.endStateConditioning, 'quality_gate_only');
}

const missing = planStoryboardActionSegments({ shot: shot(20, ['对准安装位', '固定灯具', '松手展示']), capability, firstFrameAssetId: 'frame-1' });
assert.deepEqual(missing, { status: 'blocked', reason: 'missing_split_key_states', missingAfterBeats: [1, 2] });

const planned = planStoryboardActionSegments({
  shot: shot(20, ['对准安装位', '固定灯具', '松手展示']), capability, firstFrameAssetId: 'frame-1',
  beatDurationsSeconds: [8, 8, 4],
  keyStates: [{ afterBeat: 1, description: '灯具已经对准安装位，尚未固定', source: 'confirmed_storyboard', imageAssetId: 'frame-2' }],
});
assert.equal(planned.status, 'planned');
if (planned.status === 'planned') {
  assert.equal(planned.segments.length, 2);
  assert.deepEqual(planned.segments.map(segment => [segment.beatStart, segment.beatEnd, segment.providerDurationSeconds]), [[1, 1, 8], [2, 3, 12]]);
  assert.equal(planned.segments[1]!.startState, '灯具已经对准安装位，尚未固定');
  assert.equal(planned.segments[1]!.startImageAssetId, 'frame-2');
  assert.equal(planned.readyForSubmission, true);
  assert.equal(planned.requiresSequentialGeneration, true);
}

const unrendered = planStoryboardActionSegments({
  shot: shot(20, ['对准安装位', '固定灯具', '松手展示']), capability, firstFrameAssetId: 'frame-1',
  beatDurationsSeconds: [8, 8, 4],
  keyStates: [{ afterBeat: 1, description: '灯具已经对准安装位，尚未固定', source: 'confirmed_storyboard' }],
});
assert.equal(unrendered.status, 'planned');
if (unrendered.status === 'planned') assert.equal(unrendered.readyForSubmission, false, 'a written seam does not count as a conditioning image');

const shortStages = planStoryboardActionSegments({
  shot: shot(12, ['取出灯具', '对准安装位', '固定灯具']), capability, firstFrameAssetId: 'frame-1',
  keyStates: [
    { afterBeat: 1, description: '灯具已取出，仍未对准', source: 'confirmed_storyboard' },
    { afterBeat: 2, description: '灯具已对准，仍未固定', source: 'confirmed_storyboard' },
  ], requireKeyStateSegments: true,
});
assert.equal(shortStages.status, 'planned');
if (shortStages.status === 'planned') {
  assert.equal(shortStages.segments.length, 3, 'confirmed stages must remain separate even when one 12-second clip is supported');
  assert.deepEqual(shortStages.segments.map(segment => segment.endState), ['灯具已取出，仍未对准', '灯具已对准，仍未固定', '灯具已经固定，双手离开']);
}
const tooShortForStages = planStoryboardActionSegments({
  shot: shot(8, ['取出灯具', '对准安装位', '固定灯具']), capability, firstFrameAssetId: 'frame-1',
  keyStates: [
    { afterBeat: 1, description: '灯具已取出', source: 'confirmed_storyboard' },
    { afterBeat: 2, description: '灯具已对准', source: 'confirmed_storyboard' },
  ], requireKeyStateSegments: true,
});
assert.equal(tooShortForStages.status, 'blocked');

const fractional = planStoryboardActionSegments({ shot: shot(4.5, ['涂抹防晒霜']), capability, firstFrameAssetId: 'frame-1' });
assert.equal(fractional.status, 'planned');
if (fractional.status === 'planned') {
  assert.equal(fractional.segments[0]!.providerDurationSeconds, 5);
  assert.equal(fractional.segments[0]!.trimTailSeconds, .5);
}

assert.equal(planStoryboardActionSegments({ shot: shot(20, ['对准', '固定']), capability: { ...capability, supportsFirstFrame: false } }).status, 'blocked');
assert.deepEqual(planStoryboardActionSegments({
  shot: shot(20, ['对准', '固定']), capability, beatDurationsSeconds: [7, 7],
}).status, 'blocked');

console.log('storyboardActionSegments tests passed');

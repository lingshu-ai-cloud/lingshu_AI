import assert from 'node:assert/strict';
import { planDigitalHumanPerformance, selectMotionClips, type AvatarMotionClip } from './digitalHumanPerformance.js';

const plan = planDigitalHumanPerformance({ script: '买房别只看总价。地铁和配套才是关键。现在私信领取房源对比。', durationMs: 15000 });
assert.equal(plan.version, 'performance-v1');
assert.equal(plan.beats.length, 3);
assert.equal(new Set(plan.beats.map(beat => beat.gesture)).size >= 2, true);
assert.equal(plan.beats.some(beat => beat.expression !== 'neutral'), true);
assert.equal(plan.beats.every((beat, index) => index === 0 || beat.gesture !== plan.beats[index - 1]!.gesture), true);
assert.deepEqual(plan, planDigitalHumanPerformance({ script: '买房别只看总价。地铁和配套才是关键。现在私信领取房源对比。', durationMs: 15000 }));

const singleShot = planDigitalHumanPerformance({ script: '改善置业，别只看总价。', durationMs: 3500, sceneIndex: 0 });
assert.equal(singleShot.beats.length, 1, 'one short storyboard shot must not be split into three synthetic actions');
assert.equal(singleShot.beats[0]?.intent, 'hook');
assert.equal(singleShot.beats[0]?.gesture, 'open_palm');
const englishCountShot = planDigitalHumanPerformance({ script: 'Compare three factors: budget, commute, and usable space.', durationMs: 3800, sceneIndex: 1, preset: 'commerce' });
assert.equal(englishCountShot.beats[0]?.gesture, 'count_three');
const multiSentenceHook = planDigitalHumanPerformance({ script: "Upgrading homes? Don't compare price alone.", durationMs: 3500, sceneIndex: 0, preset: 'commerce' });
assert.equal(multiSentenceHook.beats.length, 2);
assert.equal(multiSentenceHook.beats.some(beat => beat.intent === 'cta'), false, 'a translated two-sentence hook must not invent CTA intent');
assert.equal(multiSentenceHook.beats[1]?.gesture, 'open_palm');
const alternateShot = planDigitalHumanPerformance({ script: 'Verify every property detail before deciding.', durationMs: 3500, variationSeed: 2 });
assert.notEqual(performancePlanGesture(alternateShot), performancePlanGesture(planDigitalHumanPerformance({ script: 'Verify every property detail before deciding.', durationMs: 3500 })));

const clips: AvatarMotionClip[] = plan.beats.map((beat, index) => ({
  id: `clip-${index}`, avatarId: 'avatar', materialId: `material-${index}`, gesture: beat.gesture === 'none' ? 'idle' : beat.gesture,
  emotion: beat.emotion, intensity: beat.intensity, shotSize: 'medium', gaze: beat.gaze, safeStartMs: 0, safeEndMs: 5000,
  rightsStatus: 'commercial_cleared', version: 1, sourceHash: `hash-${index}`,
}));
const selected = selectMotionClips(plan, clips);
assert.equal(selected.every(item => Boolean(item.motionClipId)), true);
assert.equal(selected.every((item, index) => index === 0 || item.motionClipId !== selected[index - 1]!.motionClipId), true);
const oneBeatPlan = planDigitalHumanPerformance({ script: '预算别只看总价。', durationMs: 3500, preset: 'commerce' });
const firstChoice = selectMotionClips(oneBeatPlan, clips)[0]?.motionClipId;
const alternateChoice = selectMotionClips(oneBeatPlan, clips, false, firstChoice ? [firstChoice] : [])[0]?.motionClipId;
assert.notEqual(alternateChoice, firstChoice, 'adjust-performance must avoid the previous motion when another commercial clip exists');
console.log('digitalHumanPerformance tests passed');

function performancePlanGesture(value: ReturnType<typeof planDigitalHumanPerformance>) {
  return value.beats[0]?.gesture;
}

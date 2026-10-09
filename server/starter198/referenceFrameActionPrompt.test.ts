import assert from 'node:assert/strict';
import test from 'node:test';
import { referenceFrameActionPrompt } from './referenceFrameActionPrompt.js';

test('uses verified adjacent-frame transitions as the highest-confidence action source', () => {
  const result = referenceFrameActionPrompt({
    hookMotionEvidence: {
      status: 'verified',
      observations: [{time:0}, {time:.33}, {time:.66}, {time:1}],
      transitions: [
        {from:0, to:.33, action:'右手从腰侧抬到肩部'},
        {from:.33, to:.66, action:'右手左右摆动一次'},
      ],
    },
    beats: [{time:'0-1s', action:'拿起产品'}],
  });
  assert.equal(result.evidenceKind, 'verified_transitions');
  assert.equal(result.sampleCount, 4);
  assert.match(result.prompt, /右手从腰侧抬到肩部.*右手左右摆动一次/);
  assert.doesNotMatch(result.prompt, /拿起产品/);
});

test('uses sampled beats and explicitly forbids invented product interaction', () => {
  const result = referenceFrameActionPrompt({ motionClass:'走播', bodyMovement:'人物持续向画面右侧行走', cameraMovement:'镜头向右跟拍并轻微靠近', tempoPhases:[
    {time:'0.00-0.70s',tempo:'快速冲击',action:'向镜头突然靠近'},
    {time:'0.70-3.40s',tempo:'慢速稳定',action:'边走边说长句'},
  ], beats: [
    {time:'0.00-0.50s', action:'人物抬起右手'},
    {time:'0.50-1.00s', action:'手掌停在灯具旁'},
  ]});
  assert.equal(result.evidenceKind, 'sampled_beats');
  assert.match(result.prompt, /人物抬起右手.*手掌停在灯具旁/);
  assert.match(result.prompt, /走播.*人物持续向画面右侧行走.*向右跟拍/);
  assert.match(result.prompt, /快速冲击.*突然靠近.*慢速稳定.*边走边说长句/);
  assert.match(result.prompt, /不添加抽帧中未出现/);
});

test('does not invent motion from a static frame description', () => {
  const result = referenceFrameActionPrompt({ startState:'人物正对镜头，双手自然下垂' });
  assert.equal(result.evidenceKind, 'static_state');
  assert.match(result.prompt, /不生成未经时间序列证实的产品交互动作/);
});

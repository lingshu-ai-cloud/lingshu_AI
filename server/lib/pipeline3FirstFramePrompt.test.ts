import assert from 'node:assert/strict';
import test from 'node:test';
import { pipeline3FirstFramePrompt, PIPELINE3_FIRST_FRAME_PROMPT_VERSION } from './pipeline3FirstFramePrompt.js';

test('pipeline 3 first-frame prompt locks the source plate and limits edits to the presenter region',()=>{
  const prompt=pipeline3FirstFramePrompt({action:'向右走播',preserve:'保持跟拍'} as any);
  assert.match(prompt,/不可重绘的背景底板/);
  assert.match(prompt,/只允许在图一原人物区域内/);
  assert.match(prompt,/禁止.*改成展厅、产品柜、办公室/);
  assert.match(prompt,/向右走播/);
  assert.match(prompt,new RegExp(PIPELINE3_FIRST_FRAME_PROMPT_VERSION));
});

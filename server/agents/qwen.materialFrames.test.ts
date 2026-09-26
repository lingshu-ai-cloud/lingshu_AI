import assert from 'node:assert/strict';
import { parseMaterialFramesJson } from './qwen.js';
import { normalizeMaterialObservations } from '../lib/materialObservation.js';

const segment = { start: 0, end: 4.8, subject: ['美甲打磨笔'], observedFacts: ['画面中有一支手持打磨笔'], confidence: 0.9 };
for (const response of [JSON.stringify([segment]), JSON.stringify({ segments: [segment] })]) {
  const parsed = parseMaterialFramesJson(response);
  assert.equal(normalizeMaterialObservations('material-1', 4.85, parsed).length, 1);
}
assert.throws(() => parseMaterialFramesJson('{"items":[]}'), /没有返回可用时间区间/);
assert.throws(() => normalizeMaterialObservations('material-1', 4.85, parseMaterialFramesJson(JSON.stringify([{ ...segment, end: 9 }]))), /时间区间无效/);
console.log('Qwen material frame response shape and strict interval tests passed');

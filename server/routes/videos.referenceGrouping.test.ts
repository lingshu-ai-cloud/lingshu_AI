import assert from 'node:assert/strict';
import { groupExactObservationWindows, selectFramesForPhysicalCuts } from './videos.js';
import type { VideoAiAnalysis } from '../types/index.js';

const base: VideoAiAnalysis = {
  theme: '参考片', hooks: [], sellingPoints: [], mood: '', structure: '', recommendedScriptType: 'storyboard',
  scriptDetails15s: [
    { time: '0-4s', visual: '销售靠近镜头' },
    { time: '4-8s', visual: '销售在同一镜头举瓶' },
    { time: '8-12s', visual: '车间机器运转' },
    { time: '12-16s', visual: '车间工人走过机器' },
  ],
};
const grouped = groupExactObservationWindows(base, [8]);
assert.equal(grouped.scriptDetails15s?.length, 2, '切点之间的观察窗属于同一物理分镜');
assert.equal(grouped.scriptDetails15s?.[0]?.time, '0.00s–8.00s');
assert.equal(grouped.scriptDetails15s?.[1]?.time, '8.00s–16.00s');
assert.equal(grouped.scriptDetails15s?.[0]?.beats?.length, 2, '长镜头必须保留内部观察动作');
assert.match(grouped.scriptDetails15s?.[0]?.visual || '', /靠近镜头.*举瓶/);
const unverified = groupExactObservationWindows(base, []);
assert.equal(unverified.scriptDetails15s?.length, 4);
assert.ok(unverified.scriptDetails15s?.every(detail => detail.needsReview === true), '没有切点证据不能声称物理分镜');
const nearChunkEdge = groupExactObservationWindows({ ...base, scriptDetails15s: [
  { time: '8.73s–12.00s', visual: '车间镜头前段' },
  { time: '12.00s–12.10s', visual: '车间镜头末段' },
  { time: '12.10s–13.57s', visual: '产品镜头' },
] }, [12.10]);
assert.equal(nearChunkEdge.scriptDetails15s?.length, 2, '模型的 12 秒分块边界不能冒充附近的 12.10 秒真实切点');
assert.equal(nearChunkEdge.scriptDetails15s?.[0]?.time, '8.73s–12.10s');
const montageFrames = Array.from({ length: 26 }, (_, index) => ({ timeLabel: `${(index / 2).toFixed(2)}s` }));
const montageCuts = [5.1, 5.97, 7.17, 8.63, 10, 11, 12.53];
const montageSample = selectFramesForPhysicalCuts(montageFrames, montageCuts, 0, 13, 12);
for (let index = 0; index < montageCuts.length - 1; index += 1) {
  const from = montageCuts[index]!, to = montageCuts[index + 1]!;
  assert.ok(montageSample.some(frame => Number.parseFloat(frame.timeLabel) >= from && Number.parseFloat(frame.timeLabel) < to),
    `短产品镜头 ${from}–${to} 必须保留一帧供视觉标注`);
}
console.log('reference observation grouping tests passed');

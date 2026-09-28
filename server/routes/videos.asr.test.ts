import assert from 'node:assert/strict';
import { coarseAsrSentences, lockAsrTimeline } from './videos.js';
import type { VideoAiAnalysis } from '../types/index.js';

const analysis: VideoAiAnalysis = {
  theme: '', hooks: [], sellingPoints: [], mood: '', structure: '', recommendedScriptType: 'storyboard',
  scriptDetails15s: [
    { time: '0-2s', visual: '人物看向镜头', dialogue: '模型猜测的台词' },
    { time: '2-4s', visual: '产品特写', dialogue: '模型复制的台词' },
  ],
};
const coarse = lockAsrTimeline(analysis, { text: '一整段 30 秒口播', segments: [
  { start: 0, end: 30, text: '一整段 30 秒口播', timingPrecision: 'coarse' },
] });
assert.deepEqual(coarse.scriptDetails15s?.map(shot => shot.dialogue), ['', '']);
assert.ok(coarse.scriptDetails15s?.every(shot => shot.needsReview));
const aligned = lockAsrTimeline(analysis, { text: '第一句', segments: [
  { start: 0.2, end: 1.7, text: '第一句', timingPrecision: 'phrase' },
] });
assert.deepEqual(aligned.scriptDetails15s?.map(shot => shot.dialogue), ['第一句', '']);
const sentences = coarseAsrSentences('开场提问？回答。', 0, 3);
assert.deepEqual(sentences.map(item => item.text), ['开场提问？', '回答。']);
assert.ok(sentences.every(item => item.start === 0 && item.end === 3 && item.timingPrecision === 'coarse' && item.needsReview));
assert.deepEqual(lockAsrTimeline(analysis, { text: '开场提问？回答。', segments: sentences })
  .scriptDetails15s?.map(shot => shot.dialogue), ['', ''], '3 秒窗口也不能冒充逐句精确时间码');
assert.deepEqual(coarseAsrSentences('无效', 3, 3), []);
console.log('video ASR alignment tests passed');

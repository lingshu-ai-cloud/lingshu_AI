import assert from 'node:assert/strict';
import test from 'node:test';
import { analysisDetailsTimelineQuality, referenceTimelineQuality } from './studioReferenceTimelineQuality.js';

test('reference timeline uses visual shot ranges, not inline speech beat timestamps or target duration', () => {
  const result = referenceTimelineQuality('[0-6s] One continuous shot, speech beat [2-3s]\n[6-12s] Second shot', 15);
  assert.equal(result.valid, true);
  assert.deepEqual(result.ranges, [{ start: 0, end: 6 }, { start: 6, end: 12 }]);
  assert.equal(result.duration, 12);
});

test('reference timeline reports missing start, gaps, overlaps and real-evidence placeholders', () => {
  assert.match(referenceTimelineQuality('[1-3s] A\n[4-6s] B', 15).issues.join(','), /片头.*空档/);
  assert.match(referenceTimelineQuality('[0-3s] A\n[2-6s] B', 15).issues.join(','), /重叠/);
  assert.deepEqual(referenceTimelineQuality('分析超时，缺少真实片段', 15).issues,
    ['缺少可解析的逐镜时间戳', '分析包含超时或缺少真实片段']);
});

test('structured script details retain the same visual timeline rule', () => {
  assert.equal(analysisDetailsTimelineQuality([{ time: '[0-5s]' }, { time: '5-10s' }], 15).valid, true);
  assert.deepEqual(analysisDetailsTimelineQuality([], 15).ranges, []);
});

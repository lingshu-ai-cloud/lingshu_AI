import assert from 'node:assert/strict';
import { commercialDigitalHumanGate } from './digitalHumanQualityGate.js';

assert.equal(commercialDigitalHumanGate({ passed: true, lipSyncScore: 4.862, avOffsetFrames: 2 }, 'quality').passed, false);
assert.equal(commercialDigitalHumanGate({ passed: true, lipSyncScore: 4.862, avOffsetFrames: 2 }, 'fast').passed, true);
assert.equal(commercialDigitalHumanGate({ passed: true, lipSyncScore: 4.136, avOffsetFrames: 1, faceDetectionRate: 1, mouthJumpP95: 0.075 }, 'quality', 'musetalk-v1.5-local').passed, true);
assert.equal(commercialDigitalHumanGate({ passed: true, lipSyncScore: 7.8, avOffsetFrames: 0, freezeSegments: 0, faceDetectionRate: 1, mouthJumpP95: 0.08 }, 'quality').passed, true);
assert.equal(commercialDigitalHumanGate({ passed: true, lipSyncScore: 8, avOffsetFrames: 0, mouthJumpP95: 0.1 }, 'quality').passed, false);
const shortSegment = commercialDigitalHumanGate(
  { passed: true, lipSyncScore: 3.036, avOffsetFrames: 3, durationSeconds: 3.008 },
  'quality',
  'musetalk-v1.5-local',
  { validationScope: 'segment', expectedDurationSeconds: 3.001 },
);
assert.equal(shortSegment.passed, true);
assert.deepEqual(shortSegment.thresholds, { minimumSync: 3, maximumOffset: 3 });
assert.equal(commercialDigitalHumanGate(
  { passed: true, lipSyncScore: 2.999, avOffsetFrames: 0, durationSeconds: 3 },
  'quality',
  'musetalk-v1.5-local',
  { validationScope: 'segment', expectedDurationSeconds: 3 },
).passed, false, 'V2短分镜低于3.0必须拒绝');
assert.equal(commercialDigitalHumanGate(
  { passed: true, lipSyncScore: 2.636, avOffsetFrames: 0, durationSeconds: 15 },
  'quality',
  'musetalk-v1.5-local',
  { validationScope: 'segment', expectedDurationSeconds: 15 },
).passed, false, 'a long film cannot claim the segment threshold');
assert.equal(commercialDigitalHumanGate(
  { passed: true, lipSyncScore: 2.636, avOffsetFrames: 0, durationSeconds: 3 },
  'quality',
  'musetalk-v1.5-local',
).passed, false, 'segment relaxation requires server context');

console.log('digital human commercial quality gate tests passed');

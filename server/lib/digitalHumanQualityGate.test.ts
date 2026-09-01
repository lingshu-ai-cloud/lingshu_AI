import assert from 'node:assert/strict';
import { commercialDigitalHumanGate } from './digitalHumanQualityGate.js';

assert.equal(commercialDigitalHumanGate({ passed: true, lipSyncScore: 4.862, avOffsetFrames: 2 }, 'quality').passed, false);
assert.equal(commercialDigitalHumanGate({ passed: true, lipSyncScore: 4.862, avOffsetFrames: 2 }, 'fast').passed, true);
assert.equal(commercialDigitalHumanGate({ passed: true, lipSyncScore: 4.136, avOffsetFrames: 1, faceDetectionRate: 1, mouthJumpP95: 0.075 }, 'quality', 'musetalk-v1.5-local').passed, true);
assert.equal(commercialDigitalHumanGate({ passed: true, lipSyncScore: 7.8, avOffsetFrames: 0, freezeSegments: 0, faceDetectionRate: 1, mouthJumpP95: 0.08 }, 'quality').passed, true);
assert.equal(commercialDigitalHumanGate({ passed: true, lipSyncScore: 8, avOffsetFrames: 0, mouthJumpP95: 0.1 }, 'quality').passed, false);

console.log('digital human commercial quality gate tests passed');

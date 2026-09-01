import assert from 'node:assert/strict';
import { isShotDigitalHumanActive, isShotDigitalHumanCurrent, shotDigitalHumanSignature } from './shotDigitalHuman.js';

const base = { slotId: 'shot-1', script: '你好', language: 'zh', voiceoverUrl: '/tts/a.mp3', start: 0, end: 3, avatarMaterialId: 'avatar-1' };
const signature = shotDigitalHumanSignature(base);
assert.equal(signature, shotDigitalHumanSignature({ ...base }));
assert.notEqual(signature, shotDigitalHumanSignature({ ...base, script: '文案已修改' }));
assert.equal(isShotDigitalHumanActive('quality_check'), true);
assert.equal(isShotDigitalHumanActive('completed'), false);
assert.equal(isShotDigitalHumanCurrent({ jobId: 'j1', avatarMaterialId: 'avatar-1', status: 'completed', inputSignature: signature }, signature), true);
assert.equal(isShotDigitalHumanCurrent({ jobId: 'j1', avatarMaterialId: 'avatar-1', status: 'stale', inputSignature: signature }, signature), false);

console.log('shot digital human state tests passed');

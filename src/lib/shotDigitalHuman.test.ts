import assert from 'node:assert/strict';
import { isShotDigitalHumanActive, isShotDigitalHumanCurrent, resolveShotDigitalHumanResult, shotDigitalHumanSignature } from './shotDigitalHuman.js';

const base = { slotId: 'shot-1', script: '你好', language: 'zh', voiceoverUrl: '/tts/a.mp3', start: 0, end: 3, avatarMaterialId: 'avatar-1' };
const signature = shotDigitalHumanSignature(base);
assert.equal(signature, shotDigitalHumanSignature({ ...base }));
assert.notEqual(signature, shotDigitalHumanSignature({ ...base, script: '文案已修改' }));
assert.equal(isShotDigitalHumanActive('quality_check'), true);
assert.equal(isShotDigitalHumanActive('completed'), false);
assert.equal(isShotDigitalHumanCurrent({ jobId: 'j1', avatarMaterialId: 'avatar-1', status: 'completed', inputSignature: signature }, signature), true);
assert.equal(isShotDigitalHumanCurrent({ jobId: 'j1', avatarMaterialId: 'avatar-1', status: 'stale', inputSignature: signature }, signature), false);

// 模拟用户为一个分镜选择数字人：后台完成后只返回该分镜应绑定的素材。
const binding = { jobId: 'job-1', avatarMaterialId: 'avatar-1', status: 'processing' as const, inputSignature: signature };
const completed = resolveShotDigitalHumanResult({ binding, currentSignature: signature, jobStatus: 'completed', outputMaterialId: 'digital-shot-1' });
assert.equal(completed.assignmentMaterialId, 'digital-shot-1');
assert.equal(completed.binding.status, 'completed');
const changed = resolveShotDigitalHumanResult({ binding, currentSignature: `${signature}|changed`, jobStatus: 'completed', outputMaterialId: 'must-not-bind' });
assert.equal(changed.assignmentMaterialId, undefined);
assert.equal(changed.binding.status, 'stale');

console.log('shot digital human state tests passed');

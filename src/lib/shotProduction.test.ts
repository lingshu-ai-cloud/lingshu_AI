import assert from 'node:assert/strict';
import test from 'node:test';
import { avatarMotionPrompt, newShotProduction, patchShot, shotFingerprint, shotBlockers, recommendShot } from './shotProduction.js';
import { transcriptMatches } from './shootingWorkflow.js';
import { automaticAvatarRefreshes, avatarCandidateReady, type AvatarJob } from './shotProduction.js';
test('review failures stop automatic polling and stale or unverified candidates cannot be adopted', () => {
  const base: AvatarJob = { id: 'j1', projectId: 'p1', assemblyId: 'a1', shotId: 's1', fingerprint: 'f1', status: 'pending', createdAt: '', updatedAt: '2026-09-12T00:00:00Z' };
  const blocked = { ...base, error: '供应商已生成，但技术检查未通过' };
  assert.deepEqual(automaticAvatarRefreshes([blocked], 'p1'), []);
  assert.deepEqual(automaticAvatarRefreshes([base], 'other-project'), []);
  const many = [4, 3, 2, 1, 0].map(i => ({ ...base, id: `job${i}`, updatedAt: `2026-09-12T00:00:0${i}Z` }));
  assert.deepEqual(automaticAvatarRefreshes(many, 'p1').map(job => job.id), ['job0', 'job1', 'job2']);
  const candidate = { id: 'c1', jobId: 'j1', materialId: 'm1', fingerprint: 'f1', source: 'avatar' as const, createdAt: '' };
  assert.equal(avatarCandidateReady(candidate, [blocked]), false);
  assert.equal(avatarCandidateReady(candidate, []), false);
  assert.equal(avatarCandidateReady(candidate, [{ ...base, status: 'completed', materialId: 'wrong' }]), false);
  assert.equal(avatarCandidateReady(candidate, [{ ...base, status: 'completed', materialId: 'm1', fingerprint: 'wrong' }]), false);
  assert.equal(avatarCandidateReady(candidate, [{ ...base, status: 'completed', materialId: 'm1' }]), true);
  assert.equal(avatarCandidateReady({ ...candidate, source: 'material' }, []), true);
});
test('ASR time changes invalidate only shared-voice avatars, not reusable filmed material', () => {
  const before = JSON.stringify({ ratio: '9:16', alignment: [], alignmentSource: 'proportional' });
  const after = JSON.stringify({ ratio: '9:16', alignment: [{ start: 0.08, end: 1.84 }], alignmentSource: 'qwen_asr' });
  const shot = newShotProduction('你好');
  assert.equal(shotFingerprint(shot, before), shotFingerprint(shot, after));
  assert.equal(shotFingerprint({ ...shot, source: 'shoot' }, before), shotFingerprint({ ...shot, source: 'shoot' }, after));
  assert.notEqual(shotFingerprint({ ...shot, source: 'avatar' }, before), shotFingerprint({ ...shot, source: 'avatar' }, after));
});
test('avatar picture-in-picture requires a transparent presenter, not an opaque rectangle', () => {
  const shot = { ...newShotProduction('讲解'), source: 'avatar' as const, layout: 'pip' as const, productMaterialId: 'product' };
  assert.ok(shotBlockers(shot, '').some(message => message.includes('去背景')));
  assert.ok(!shotBlockers({ ...shot, transparent: true }, '').some(message => message.includes('去背景')));
  assert.ok(!shotBlockers({ ...shot, layout: 'full' }, '').some(message => message.includes('去背景')));
});
test('independent layers reuse the avatar; changed identity, speech or baked backgrounds invalidate it', () => {
  const shot = { ...newShotProduction('设备演示', 'alice'), source: 'avatar' as const };
  const fingerprint = shotFingerprint(shot, 'context');
  assert.equal(shotFingerprint(patchShot(shot, { backgroundMaterialId: 'factory', layout: 'pip', productMaterialId: 'image' }), 'context'), fingerprint);
  for (const patch of [{ presenterId: 'bob' }, { narration: '新台词' }, { productId: 'sku2' }, { backgroundMode: 'baked' as const, backgroundMaterialId: 'other' }]) assert.notEqual(shotFingerprint(patchShot(shot, patch), 'context'), fingerprint);
});
test('locks block edits, and changing SKU resets fact confirmation', () => {
  assert.throws(() => patchShot({ ...newShotProduction(), locked: true }, { layout: 'pip' }), /解锁/);
  assert.equal(patchShot({ ...newShotProduction(), locked: true }, { locked: false }).locked, false);
  assert.equal(patchShot({ ...newShotProduction(), factsConfirmed: true }, { productId: 'new' }).factsConfirmed, false);
});
test('old candidates cannot be silently published against changed requirements', () => {
  const shot = { ...newShotProduction('old'), source: 'avatar' as const };
  const current = { ...shot, adoptedId: 'v1', candidates: [{ id: 'v1', materialId: 'm', source: 'avatar' as const, fingerprint: shotFingerprint(shot, 'context'), createdAt: '' }] };
  assert.deepEqual(shotBlockers(current, 'context'), []);
  assert.ok(shotBlockers({ ...current, narration: 'new' }, 'context').length);
  assert.ok(shotBlockers({ ...current, layout: 'pip' }, 'context').length);
});
test('evidence and real-person preferences never turn into synthetic proof', () => {
  const input = { detail: '展示检测证书', preference: 'avatar' as const, locked: false, hasMaterial: false, hasPresenter: true };
  assert.equal(recommendShot(input).source, 'shoot');
  assert.equal(recommendShot({ ...input, hasMaterial: true }).source, 'material');
  assert.equal(recommendShot({ ...input, detail: '产品解释', preference: 'none' }).source, 'material');
  assert.equal(recommendShot({ ...input, detail: '产品解释', preference: 'real' }).source, 'shoot');
  assert.equal(recommendShot({ ...input, detail: '产品解释' }).source, 'avatar');
});
test('audio changes invalidate lip-sync only when using the shared voiceover', () => {
  const shared = { ...newShotProduction('hello'), source: 'avatar' as const };
  const a = JSON.stringify({ language: 'en', audioIdentity: '/a.wav' }), b = JSON.stringify({ language: 'en', audioIdentity: '/b.wav' });
  assert.notEqual(shotFingerprint(shared, a), shotFingerprint(shared, b));
  assert.equal(shotFingerprint({ ...shared, sound: 'source' }, a), shotFingerprint({ ...shared, sound: 'source' }, b));
  assert.notEqual(shotFingerprint(shared, JSON.stringify({ audioSegments: [{ id: 'a', duration: 3 }] })), shotFingerprint(shared, JSON.stringify({ audioSegments: [{ id: 'a', duration: 4 }] })));
});
test('recorded speech requires actual matching transcription, not a script hint', () => {
  assert.equal(transcriptMatches(undefined, '产能100台'), false);
  assert.equal(transcriptMatches('产能10台', '产能100台'), false);
  assert.equal(transcriptMatches('Hello, WORLD!', 'hello world'), true);
});
test('avatar performance presets produce bounded motion prompts and invalidate stale candidates', () => {
  const natural = newShotProduction('新品到了');
  const surprise = { ...natural, performancePreset: 'surprise_marketing' as const, emotionIntensity: 0.8 };
  assert.match(avatarMotionPrompt(surprise, 4), /0-1s:.*raise eyebrows.*1-3s:.*never stretch lips.*3-4s:.*original mouth and teeth shape/i);
  assert.match(avatarMotionPrompt(natural, 4), /original mouth and teeth shape.*no enlarged, extra, or overly white teeth/i);
  assert.notEqual(shotFingerprint(natural, 'ctx'), shotFingerprint(surprise, 'ctx'));
  assert.equal(avatarMotionPrompt({ ...surprise, motionPrompt: 'Point to the product.' }), 'Point to the product.');
});
import { parseShotCommand, productionSummary } from './shotProduction';

test('shot commands are scoped, explicit and never execute supplier actions', () => {
  assert.deepEqual(parseShotCommand('改成画中画'), { layout: 'pip' });
  assert.deepEqual(parseShotCommand('台词改为：这是一台设备。'), { narration: '这是一台设备。' });
  assert.deepEqual(parseShotCommand('解锁镜头'), { locked: false });
  assert.deepEqual(parseShotCommand('改成精准口播'), { source: 'avatar', avatarMode: 'presenter', transparent: false });
  assert.deepEqual(parseShotCommand('改成运镜口播'), { source: 'avatar', avatarMode: 'cinematic', transparent: false });
  assert.deepEqual(parseShotCommand('改成透明人物层'), { source: 'avatar', avatarMode: 'overlay', transparent: true });
  assert.equal(parseShotCommand('把所有镜头生成并直接发布'), null);
  assert.equal(productionSummary({}), '');
});

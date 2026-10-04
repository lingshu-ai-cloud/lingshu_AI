import assert from 'node:assert/strict';
import { digitalHumanDecisionIssues, enterpriseMaterialIssue } from './smartStoryboardAdmission.js';
const input = { workflow: 'viral_replication' as const, method: 'reenact' as const, presenterSelected: true,
  replacementScope: 'person_and_scene' as const, targetEffect: 'flexible_scene' as const,
  contentConfirmed: true, action: '', scene: '', preserve: '' };
assert.deepEqual(digitalHumanDecisionIssues(input), []);
assert.ok(digitalHumanDecisionIssues({ ...input, presenterSelected: false }).some(reason => /企业人物/.test(reason)));
assert.ok(digitalHumanDecisionIssues({ ...input, replacementScope: 'face_only' }).some(reason => /尚未接入/.test(reason)));
assert.ok(digitalHumanDecisionIssues({ ...input, method: 'talking' }).some(reason => /不能使用口播/.test(reason)));
assert.ok(digitalHumanDecisionIssues({ ...input, targetEffect: undefined }).some(reason => /生成效果/.test(reason)));

const material = { type: 'video', url: '/owned.mp4', duration: 10, width: 1080, height: 1920, transcript: 'Contact us now.' };
assert.equal(enterpriseMaterialIssue({ material, duration: 3, ratio: '9:16', sound: 'source', narration: 'Contact us' }), null);
assert.equal(enterpriseMaterialIssue({ material, duration: 3, ratio: '16:9', sound: 'silent' }), null, '不同画幅可在渲染时适配，不阻断素材');
assert.equal(enterpriseMaterialIssue({ material: { ...material, width: 0, height: 0 }, duration: 3, ratio: '9:16', sound: 'silent' }), null, '缺少画幅元数据也不阻断素材');
assert.match(enterpriseMaterialIssue({ material, duration: 20 }) || '', /时长/);
assert.match(enterpriseMaterialIssue({ material: { ...material, usage: 'reference_only' }, duration: 3 }) || '', /企业素材/);
assert.match(enterpriseMaterialIssue({ material, duration: 3, sound: 'source', narration: 'Different words' }) || '', /原声/);

const twin = { ...input, presenterMode: 'video_twin' as const, workflow: 'material_processing' as const, method: 'talking' as const, replacementScope: undefined, targetEffect: 'natural_talking' as const };
assert.deepEqual(digitalHumanDecisionIssues(twin), []);
const photo = { ...input, presenterMode: 'photo_talking' as const, workflow: 'viral_replication' as const, method: 'reenact' as const, preferredProvider: 'sd' as const, replicationMode: 'sentence_first_frame' as const };
assert.deepEqual(digitalHumanDecisionIssues(photo), []);
assert.ok(digitalHumanDecisionIssues({ ...photo, method: 'talking' }).some(reason => /Seedream/.test(reason)));
assert.deepEqual(digitalHumanDecisionIssues({ ...photo, workflow: 'material_processing', method: 'talking' }), []);

// Muted enterprise footage needs no speech recognition, even with different narration.
assert.equal(enterpriseMaterialIssue({ material: { ...material, transcript: '' }, duration: 3, sound: 'voiceover', narration: 'Different words' }), null);
assert.equal(enterpriseMaterialIssue({ material, duration: 3, sound: 'silent', narration: 'Different words' }), null);
assert.equal(enterpriseMaterialIssue({ material: { ...material, transcript: '' }, duration: 3, sound: 'source', narration: 'Different words' }), '已开启素材原声，请确认素材台词');

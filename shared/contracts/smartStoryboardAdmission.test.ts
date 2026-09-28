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
assert.match(enterpriseMaterialIssue({ material, duration: 20 }) || '', /时长/);
assert.match(enterpriseMaterialIssue({ material: { ...material, usage: 'reference_only' }, duration: 3 }) || '', /企业素材/);
assert.match(enterpriseMaterialIssue({ material, duration: 3, sound: 'source', narration: 'Different words' }) || '', /原声/);

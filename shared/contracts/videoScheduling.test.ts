import assert from 'node:assert/strict';
import { normalizeVideoPlan, videoPlanErrors, videoSchedulingErrors } from './videoCreationPlan.js';

const candidate = normalizeVideoPlan({ route: 'clone', directorStatus: 'candidate', productName: '精华液', theme: '产品选型', language: 'en', presenter: 'material' });
assert.deepEqual(videoSchedulingErrors(candidate), [], 'initial scheduling must allow Director reference collection afterward');
assert.ok(videoPlanErrors(candidate).includes('请选择爆款参考'), 'production must still require a reference');
for (const directorStatus of ['script_draft', 'script_approved', 'in_production', 'blocked'] as const) {
  assert.ok(videoSchedulingErrors({ ...candidate, directorStatus }).includes('请选择爆款参考'), 'later stages must retain reference validation');
}
assert.ok(videoSchedulingErrors({ ...candidate, productName: '' }).includes('请选择产品'));
assert.ok(videoSchedulingErrors({ ...candidate, theme: '' }).includes('请填写本条主题或买家问题'));
assert.ok(videoSchedulingErrors({ ...candidate, route: 'material', materialIds: [] }).includes('请选择本条素材'));
assert.deepEqual(videoSchedulingErrors({ ...candidate, referenceId: 'reference-ready' }), []);
console.log('video scheduling validation passed');

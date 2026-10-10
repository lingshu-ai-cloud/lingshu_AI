import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SOCIAL_WORK_PACKAGE_TRANSITIONS,
  normalizeSocialWorkPackageVersion,
  socialWorkPackageActivationMissing,
} from './socialWorkPackageAdminApi.js';

assert.deepEqual(SOCIAL_WORK_PACKAGE_TRANSITIONS, {
  draft: ['internal_trial', 'retired'],
  internal_trial: ['draft', 'active', 'retired'],
  active: ['retired'],
  retired: [],
});

const normalized = normalizeSocialWorkPackageVersion({
  kind: 'content_rocket',
  packageKey: 'content_rocket',
  version: 'framework-v1',
  name: '内容火箭包',
  summary: null,
  status: 'draft',
  available: false,
  requiredInputs: [],
  deliverables: [],
  framework: {
    applicability: [],
    requiredInputs: [],
    workOutline: [],
    deliverables: [],
    userDecisions: [],
    qualityChecks: [],
    metricRequirements: [],
    fallbackPolicy: [],
  },
  effectiveFrom: null,
  effectiveUntil: null,
  recordVersion: '1',
  updatedAt: '2026-09-14T00:00:00.000Z',
  builtin: false,
});
assert.equal(normalized.name, '内容火箭包');
assert.equal(normalized.framework.workOutline.length, 0, 'the framework must remain empty until an administrator fills it');
assert.deepEqual(socialWorkPackageActivationMissing(normalized), ['适用说明', '需要资料', '交付清单']);
assert.deepEqual(socialWorkPackageActivationMissing({
  ...normalized,
  summary: '已填写',
  framework: { ...normalized.framework, requiredInputs: ['已填写'], deliverables: ['已填写'] },
}), []);
assert.throws(() => normalizeSocialWorkPackageVersion({ ...normalized, status: 'published' }), /数据不完整/);
assert.throws(() => normalizeSocialWorkPackageVersion({
  ...normalized,
  framework: { ...normalized.framework, deliverables: 'not-a-list' },
}), /数据不完整/);

const apiSource = readFileSync(new URL('./socialWorkPackageAdminApi.ts', import.meta.url), 'utf8');
const componentSource = readFileSync(new URL('../components/AdminSocialWorkPackageCenter.tsx', import.meta.url), 'utf8');
const deliverySource = readFileSync(new URL('../components/AdminDeliveryPage.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const routerSource = readFileSync(new URL('../../server/starter198/socialContentRouter.ts', import.meta.url), 'utf8');

assert.match(apiSource, /social-content\/internal\/work-packages/);
assert.match(apiSource, /'Idempotency-Key': mutationKey\(\)/, 'every frontend mutation must carry an idempotency key');
assert.match(apiSource, /method: 'PATCH'/);
assert.match(apiSource, /\/status`/);
assert.match(routerSource, /router\.get\('\/internal\/work-packages'/);
assert.match(routerSource, /router\.post\('\/internal\/work-packages'/);
assert.match(routerSource, /router\.patch\('\/internal\/work-packages\/:packageKey\/:version'/);
assert.match(routerSource, /await requirePlatformAdmin\(req\)/, 'the server must enforce platform-admin access');
assert.match(appSource, /page === 'adminDelivery'\) && !isAdminSession\(session\)/,
  'the work-package center host page must stay restricted to verified platform administrators');

for (const label of ['行业起航包', '内容火箭包', '任务飞车包']) assert.match(componentSource, new RegExp(label));
for (const label of ['适用范围', '需要资料', '作业步骤', '交付清单', '客户确认点', '质量检查', '数据回收要求', '异常处理']) assert.match(componentSource, new RegExp(label));
for (const label of ['草稿', '内部试用', '正式可用', '停用', '客户卡片预览', '适用说明', '需要资料', '交付内容']) assert.match(componentSource, new RegExp(label));
assert.match(componentSource, /item\.builtin/);
assert.match(componentSource, /selected\.builtin/, 'the built-in framework cannot be edited or transitioned');
assert.equal((deliverySource.match(/<AdminSocialWorkPackageCenter\s*\/>/g) || []).length, 1,
  'AdminDeliveryPage should contain exactly one minimal work-package center mount');

console.log('Admin social work package frontend contracts passed');

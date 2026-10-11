import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSceneVisualContract } from '../../shared/sceneVisualContract.js';
import { materialRoutingRequests } from './socialContentMaterialRoutingRequests.js';
import { parseCreateSocialTask, parseUpdateSocialTask } from './socialContentValidation.js';
import { defaultBrief } from './socialContentTaskSupport.js';
import { parseSocialTaskBrief } from './socialContentRecords.js';

const visual = (action = '手握包装盒晃一圈') => normalizeSceneVisualContract({
  subjects: ['person', 'product'], interaction: { kind: 'person_holding_product', description: action },
  action: { path: action }, productRef: 'SKU-1', productPolicy: 'locked',
});
const shot = { shotId: 'S1', function: 'demonstration' as const, requestedDescription: '手握包装盒晃一圈',
  visualContract: visual(), productRef: 'SKU-1' };
const candidate = (overrides: Record<string, unknown> = {}) => ({ assetId: 'own-video', sourceRef: 'own-video',
  segmentId: 'seg-1', origin: 'my_materials', mediaType: 'video', productRef: 'SKU-1',
  materialRoles: ['product'], visualContract: visual(), timeRange: { startSeconds: 2, endSeconds: 6 }, ...overrides }) as never;
const requests = (candidates: never[]) => materialRoutingRequests({ policyVersion: 'type-aware.v1',
  tenantId: 'tenant', shots: [shot], candidates, productRef: 'SKU-1' });

test('normal API creation persists the policy while historic briefs remain unmarked', () => {
  const brief = defaultBrief(parseCreateSocialTask({ title: '产品视频', objective: '介绍产品' }));
  assert.equal(parseSocialTaskBrief(brief).materialRoutingPolicyVersion, 'type-aware.v1');
  const { materialRoutingPolicyVersion: _, ...legacy } = brief;
  assert.equal(parseSocialTaskBrief(legacy).materialRoutingPolicyVersion, undefined);
  assert.throws(() => parseSocialTaskBrief({ ...brief, materialRoutingPolicyVersion: 'unknown' }), /social_material_routing_policy_invalid/);
  assert.deepEqual(parseUpdateSocialTask({ expectedVersion: 'v65', changes: { title: '更新标题' } }).changes, { title: '更新标题' });
});
test('local product match retains its action evidence, SKU and exact analyzed segment', () => {
  const result = requests([candidate()])[0]!;
  assert.equal(result.materialType, 'product');
  assert.deepEqual(result.localVideoMatch?.sourceRefs, ['own-video']);
  assert.match(result.localVideoMatch?.evidenceRef ?? '', /^material-visual-match:tenant:/);
  assert.deepEqual(result.selectedMaterialSegment, { sourceRef: 'own-video', segmentId: 'seg-1', startSeconds: 2, endSeconds: 6 });
});
test('inventory presence, wrong product, still image and missing movement are not verified matches', () => {
  for (const item of [candidate({ productRef: 'other' }), candidate({ mediaType: 'image' }),
    candidate({ origin: 'shared_library' }), candidate({ synthetic: true }), candidate({ visualContract: visual('手握包装盒静止展示') }),
    candidate({ timeRange: { startSeconds: 0, endSeconds: 2 } })]) {
    assert.equal(requests([item])[0]?.localVideoMatch, undefined);
  }
});
test('legacy request identity is preserved and is not silently routed to a new policy', () => {
  const shots = [shot];
  assert.equal(materialRoutingRequests({ tenantId: 'tenant', shots, candidates: [candidate()], productRef: 'SKU-1' }), shots);
});
test('positive motion remains required beside a packaging prohibition and stale proofs are cleared', () => {
  const prior = { ...shot, requestedDescription: '手持旋转产品，禁止改标签',
    localVideoMatch: { sourceRefs: ['gone'], semanticMatch: 'verified' as const, productRef: 'SKU-1', evidenceRef: 'old' },
    selectedMaterialSegment: { sourceRef: 'gone', segmentId: 'old', startSeconds: 0, endSeconds: 4 } };
  const result = materialRoutingRequests({ policyVersion: 'type-aware.v1', tenantId: 'tenant',
    shots: [prior], candidates: [candidate({ visualContract: visual('手握产品静止展示') })], productRef: 'SKU-1' })[0]!;
  assert.equal(result.localVideoMatch, undefined);
  assert.equal(result.selectedMaterialSegment, undefined);
});

test('new product tasks default to a ten-yuan whole-film ceiling and cannot raise it through creation input', () => {
  for (const requested of [undefined, null, 600, 10, 4]) {
    const input = parseCreateSocialTask({ title: '预算检查', objective: '产品正常制作', perItemBudgetCny: requested });
    const expected = requested === 4 ? 4 : 10;
    assert.equal(input.perItemBudgetCny, expected);
    assert.equal(defaultBrief(input).perItemBudgetCny, expected);
  }
  assert.equal(defaultBrief({ title: '内部创建', objective: '制作', perItemBudgetCny: 600 } as never).perItemBudgetCny, 10);
});

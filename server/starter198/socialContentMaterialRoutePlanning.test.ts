import test from 'node:test';
import assert from 'node:assert/strict';
import { createSocialAssetSupplyPlan } from '../../shared/socialContentAssetSupply.js';
import { defaultBrief } from './socialContentTaskSupport.js';
import { parseCreateSocialTask } from './socialContentValidation.js';
import { planNewSocialMaterialRoutes } from './socialContentMaterialRoutePlanning.js';
import type { Starter198Repository } from './repository.js';
import type { ResolvedSocialTaskReference } from './socialContentScriptSources.js';
import { SOCIAL_WORK_PACKAGE_KINDS } from '../../shared/contracts/socialContentWorkflow.js';

const plan = createSocialAssetSupplyPlan({ creationMode: 'viral_replication', productionApproach: 'ai_enhanced',
  materialRoutingPolicyVersion: 'type-aware.v1', inventory: { productImageIds: ['KB'] },
  shots: [{ shotId: 'product', function: 'demonstration', materialType: 'product', requestedDescription: '产品手持晃一圈' }] });
const fixture = () => ({ match: {}, referenceVideoAnalysis: { shots: [] }, shotMaterialMap: [],
  replicationScript: { version: 'draft-1', referenceAnalysisId: 'analysis', status: 'draft', shots: [
    { shotId: 'product', startSeconds: 0, endSeconds: 8, purpose: 'demonstration', visualInstruction: '产品手持晃一圈',
      spokenText: null, materialPlan: { ...structuredClone(plan.shots[0]), materialRouting: undefined } },
  ] } }) as unknown as ResolvedSocialTaskReference;
const task = () => ({ id: 'row-1', task_id: 'public-task', status: 'draft', version: '1',
  source_count: 0, knowledge_source_count: 0, material_source_count: 0, artifact_count: 0, approved_artifact_count: 0,
  delivery_package_count: 0, publication_count: 0, metric_submission_count: 0,
  package_selection: SOCIAL_WORK_PACKAGE_KINDS.map(kind => ({ kind, packageKey: kind, version: '1', name: kind })),
  created_at: '2026-10-11', updated_at: '2026-10-11',
  brief: defaultBrief(parseCreateSocialTask({ title: '产品', objective: '介绍产品', creationMode: 'viral_replication' })) });
const forbidden = async () => { throw Error('unexpected mutation'); };
const repository = { list: async () => ({ items: [task()], totalItems: 1, page: 1, perPage: 2, totalPages: 1 }),
  get: async () => null, create: forbidden, update: forbidden, access: forbidden } as unknown as Starter198Repository;

test('new planning uses a transient canonical row, then returns one typed three-second script for freezing', async () => {
  const source = fixture(), before = JSON.stringify(source);
  const result = await planNewSocialMaterialRoutes({ repository, tenantId: 'tenant', task: task(), resolved: source,
    readDetail: async input => {
      assert.equal(input.taskId, 'public-task');
      const rows = await input.repository.list('starter_social_content_tasks', 'tenant', { where: { task_id: 'public-task' } });
      assert.equal(rows.items[0]!.replication_script, source.replicationScript);
      return { assetSupplyPlan: plan } as never;
    } });
  assert.equal(result.replicationScript.shots[0]!.endSeconds, 3);
  assert.equal(result.replicationScript.shots[0]!.materialPlan.productSceneReplication!.cameraLock.durationSeconds, 3);
  assert.equal(result.replicationScript.status, 'review_required');
  assert.equal(JSON.stringify(source), before);
});
test('historical, confirmed and explicit revision scripts never enter new planning', async () => {
  for (const kind of ['historical', 'confirmed', 'revision'] as const) {
    const row = task(), resolved = fixture();
    if (kind === 'historical') delete row.brief.materialRoutingPolicyVersion;
    if (kind === 'confirmed') resolved.replicationScript.status = 'confirmed';
    if (kind === 'revision') (row.brief as unknown as Record<string, unknown>)._productionRevision = { version: 65 };
    assert.equal(await planNewSocialMaterialRoutes({ repository, tenantId: 'tenant', task: row, resolved,
      readDetail: forbidden }), resolved);
  }
});

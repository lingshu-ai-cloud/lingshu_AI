import assert from 'node:assert/strict';
import {
  buildSocialDirectorPlan,
  type SocialDirectorBgmSelection,
  type StoredSocialDirectorPlan,
} from './socialContentDirectorPlan.js';
import {
  persistSocialDirectorPlanVersion,
  readSocialDirectorPlanVersion,
  resolveSocialDirectorArtifactLineage,
} from './socialContentDirectorPlanVersions.js';
import type { SocialProductionAsset, SocialProductionPlan } from './socialContentProductionPlan.js';
import { freezeSocialScriptBaseline } from './socialContentScriptBaseline.js';
import {
  STARTER_COLLECTIONS,
  type Starter198Repository,
  type StarterCollection,
  type StarterRecord,
} from './repository.js';

const tenantId = 'tenant-director-version-history';
const taskId = 'social-task-director-version-history';
const firstCreatedAt = '2026-09-21T01:00:00.000Z';
const verifiedContext = {
  productName: '已确认精华液',
  facts: [
    { key: 'category', label: '类别', value: '护肤品' },
    { key: 'material', label: '材质', value: '玻璃瓶' },
  ],
  source: 'enterprise_product' as const,
  confidence: 1,
};
const baseline = freezeSocialScriptBaseline({
  brief: {
    title: '精华液产品实拍', objective: '展示产品', productRef: '已确认精华液', audience: '采购商',
    markets: ['中国'], languages: ['中文'], platforms: ['抖音'], formats: ['短视频'], aspectRatio: '9:16',
    cadence: null, requestedOutputCount: 1, dueAt: null, brandNotes: null, restrictions: [], callToAction: null,
  },
  theme: { themeId: 'product_value', inputKind: 'preset', topic: '产品实拍', classificationStatus: 'confirmed' },
  verifiedContext,
  lockedAt: firstCreatedAt,
});

const assets: SocialProductionAsset[] = [
  {
    id: 'asset-front', sourceId: 'source-front', name: '产品正面', type: 'video',
    url: '/tmp/product-front.mp4', contentHash: 'a'.repeat(64), duration: 6,
    visualObservations: ['产品实拍 产品全貌'],
    segments: [{ id: 'front', start: 0, end: 4, confidence: 0.94, observedFacts: '产品实拍 产品全貌' }],
  },
  {
    id: 'asset-detail', sourceId: 'source-detail', name: '产品细节', type: 'video',
    url: '/tmp/product-detail.mp4', contentHash: 'b'.repeat(64), duration: 6,
    visualObservations: ['产品细节 真实素材'],
    segments: [{ id: 'detail', start: 0, end: 4, confidence: 0.92, observedFacts: '产品细节 真实素材' }],
  },
];
const baselineScenes = [baseline.scenes[0]!, baseline.scenes[baseline.scenes.length - 1]!];
const productionPlan: SocialProductionPlan = {
  ok: true,
  reasonCode: 'ready',
  message: 'ready',
  scenes: baselineScenes.map((scene, index) => ({
    sceneId: scene.sceneId,
    baselineSceneIndex: index === 0 ? 0 : baseline.scenes.length - 1,
    shotFunction: scene.shotFunction,
    subject: scene.subject,
    action: scene.action,
    baselineNarration: scene.narration,
    narration: scene.narration,
    clip: {
      clipId: `${assets[index]!.id}:clip`, evidenceShotId: `${assets[index]!.id}:shot`,
      assetId: assets[index]!.id, assetName: assets[index]!.name, type: 'video',
      start: 0, end: 4, sourceDuration: 4, observations: assets[index]!.visualObservations,
      confidence: index === 0 ? 0.94 : 0.92, needsReview: false, evidenceBasis: 'visual_analysis',
    },
    semanticScore: 0.9,
  })),
  selectedAssetIds: assets.map(asset => asset.id),
  unusedAssets: [],
  narrationChanged: true,
  maxDuration: 8,
  sourceClipSeconds: 8,
  averageConfidence: 0.93,
  notes: [],
};
const bgmSelection: SocialDirectorBgmSelection = {
  primary: {
    trackId: 'builtin-safe-track', name: '内置商用配乐', mood: '稳重',
    authorization: {
      status: 'authorized', basis: 'lingshu_builtin_library', license: '灵枢内置商用曲库授权',
      evidence: 'authenticated_catalog:builtin-safe-track',
    },
  },
  fallbacks: [],
  fallbackPolicy: 'ordered_preapproved_tracks_only',
  volume: 18,
};

function makePlan(createdAt: string, previous?: StoredSocialDirectorPlan): StoredSocialDirectorPlan {
  return buildSocialDirectorPlan({
    taskId,
    baseline,
    productionPlan,
    productionAssets: assets,
    sourceVersions: { 'source-front': '7', 'source-detail': '8' },
    outputSpec: { aspectRatio: '9:16', resolution: '720p', platform: 'douyin' },
    bgmSelection,
    createdAt,
    previous,
  });
}

function memoryRepository() {
  const rows = new Map<StarterCollection, StarterRecord[]>();
  let sequence = 0;
  const repository: Starter198Repository = {
    async list(collection, requestedTenantId, query = {}) {
      const matching = (rows.get(collection) ?? []).filter(row => (
        row.tenant_id === requestedTenantId
        && Object.entries(query.where ?? {}).every(([key, value]) => row[key] === value)
      ));
      const perPage = query.perPage ?? 500;
      return {
        items: matching.slice(0, perPage).map(row => structuredClone(row)),
        totalItems: matching.length,
        totalPages: Math.max(1, Math.ceil(matching.length / perPage)),
        page: 1,
        perPage,
      };
    },
    async get(collection, requestedTenantId, id) {
      const row = (rows.get(collection) ?? []).find(item => item.tenant_id === requestedTenantId && item.id === id);
      return row ? structuredClone(row) : null;
    },
    async create(collection, requestedTenantId, data) {
      const row: StarterRecord = {
        id: `version-row-${++sequence}`,
        ...structuredClone(data),
        tenant_id: requestedTenantId,
      };
      rows.set(collection, [...(rows.get(collection) ?? []), row]);
      return structuredClone(row);
    },
    async update() { throw new Error('immutable version records may not be updated'); },
    async access() { throw new Error('not used by this test'); },
  };
  return { repository, rows };
}

const memory = memoryRepository();
const planV1 = makePlan(firstCreatedAt);
const savedV1 = await persistSocialDirectorPlanVersion({
  repository: memory.repository,
  tenantId,
  taskId,
  plan: planV1,
  baseline,
  verifiedContext,
});
assert.equal(savedV1.created, true);
assert.equal(savedV1.versionRecord.version, '1');
assert.equal(savedV1.versionRecord.factSnapshot.captureMode, 'verified_context');
assert.deepEqual(savedV1.versionRecord.factSnapshot.facts, verifiedContext.facts);
assert.equal(savedV1.versionRecord.materialSnapshot.length, 2);
assert.equal(savedV1.reference.directorPlanId, planV1.directorPlanId);
assert.equal(savedV1.reference.version, planV1.version);
assert.equal(savedV1.reference.lineageHash, planV1.lineageHash);

const replayedV1 = await persistSocialDirectorPlanVersion({
  repository: memory.repository,
  tenantId,
  taskId,
  plan: planV1,
  baseline,
  verifiedContext,
});
assert.equal(replayedV1.created, false, 'the exact same immutable write is idempotent');
assert.equal(memory.rows.get(STARTER_COLLECTIONS.socialDirectorPlanVersions)?.length, 1);
const compatibilityProbeV1 = await persistSocialDirectorPlanVersion({
  repository: memory.repository,
  tenantId,
  taskId,
  plan: planV1,
});
assert.equal(compatibilityProbeV1.created, false);
assert.equal(compatibilityProbeV1.versionRecord.factSnapshot.captureMode, 'verified_context',
  'a legacy backfill probe must never downgrade an existing verified snapshot');

const planV2 = makePlan('2026-09-21T01:01:00.000Z', planV1);
const savedV2 = await persistSocialDirectorPlanVersion({
  repository: memory.repository,
  tenantId,
  taskId,
  plan: planV2,
  baseline,
  verifiedContext,
});
assert.equal(savedV2.versionRecord.version, '2');
assert.equal(savedV2.versionRecord.previousVersion, '1');
assert.equal(memory.rows.get(STARTER_COLLECTIONS.socialDirectorPlanVersions)?.length, 2,
  'a later version appends and must not replace v1');
assert.equal((await readSocialDirectorPlanVersion({
  repository: memory.repository, tenantId, directorPlanId: planV1.directorPlanId, version: '1',
}))?.lineageHash, planV1.lineageHash);
assert.equal(await readSocialDirectorPlanVersion({
  repository: memory.repository, tenantId: 'other-tenant', directorPlanId: planV1.directorPlanId, version: '1',
}), null, 'immutable history remains tenant-scoped');

const resolved = await resolveSocialDirectorArtifactLineage({
  repository: memory.repository,
  tenantId,
  taskId,
  reference: savedV2.reference,
});
assert.equal(resolved.lineageHash, planV2.lineageHash);
assert.equal(resolved.factSnapshotHash, savedV2.reference.factSnapshotHash);
assert.equal(resolved.materialSnapshotHash, savedV2.reference.materialSnapshotHash);
assert.deepEqual(resolved.materialSnapshot.map(item => item.contentHash), ['a'.repeat(64), 'b'.repeat(64)]);

await assert.rejects(() => resolveSocialDirectorArtifactLineage({
  repository: memory.repository,
  tenantId,
  taskId,
  reference: { ...savedV2.reference, lineageHash: 'f'.repeat(64) },
}), /social_content_director_plan_lineage_not_found/);

const competingV1 = makePlan('2026-09-21T01:02:00.000Z');
await assert.rejects(() => persistSocialDirectorPlanVersion({
  repository: memory.repository,
  tenantId,
  taskId,
  plan: competingV1,
  baseline,
  verifiedContext,
}), /social_content_director_plan_version_immutable_conflict/);
assert.equal(memory.rows.get(STARTER_COLLECTIONS.socialDirectorPlanVersions)?.length, 2);

const missingHistory = memoryRepository();
await assert.rejects(() => persistSocialDirectorPlanVersion({
  repository: missingHistory.repository,
  tenantId,
  taskId,
  plan: planV2,
  baseline,
  verifiedContext,
}), /social_content_director_plan_predecessor_missing/,
'a newly verified version cannot create a broken history chain');
const legacyBackfill = await persistSocialDirectorPlanVersion({
  repository: missingHistory.repository,
  tenantId,
  taskId,
  plan: planV2,
});
assert.equal(legacyBackfill.versionRecord.factSnapshot.captureMode, 'legacy_plan_only',
  'an old task projection can be preserved without pretending current facts were used historically');

const storedRows = memory.rows.get(STARTER_COLLECTIONS.socialDirectorPlanVersions)!;
storedRows[0]!.material_snapshot_hash = '0'.repeat(64);
await assert.rejects(() => readSocialDirectorPlanVersion({
  repository: memory.repository, tenantId, directorPlanId: planV1.directorPlanId, version: '1',
}), /social_content_director_plan_version_invalid/, 'snapshot tampering is rejected');

console.log('Social Director Plan immutable version history tests passed');

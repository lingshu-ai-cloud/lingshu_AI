import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import {
  assetRenderUrl,
  allocateBalancedContentRoutes,
  automatedContentQualityNeedsRevalidation,
  CONTENT_SCRIPT_QUALITY_RULE_VERSION,
  contentProductionKnowledgeGaps,
  contentOrderCoverage,
  listTenantContentProjects,
  contentProjectBlockIsSemanticallyUnchanged,
  deterministicClosedWorldStoryboard,
  buildRouteSourcePlans,
  containsInternalContentMarker,
  contentFingerprint,
  detectContentDuplication,
  isLlmUnavailableError,
  matchSceneSources,
  platformCreativeBrief,
  productionTiming,
  resolveEnterpriseAssetLocation,
  resumeContentProjectForTaskControl,
  selectExplicitFocusProducts,
  selectContentProjectsForTick,
  proportionalCues,
  splitSubtitleUnits,
  subtitleCuesAreSafe,
  type AssetCandidate,
} from './contentProduction.js';
import { enterpriseAssetObjectKey, enterpriseAssetTenantKey } from '../storage/enterpriseAssets.js';
import { assessScriptQualityV2, hardScriptSafetyIssues } from '../lib/studioScriptQualityV2.js';
import { inspectRenderedVisuals } from '../lib/renderVisualQuality.js';
import { store } from '../storage/index.js';

const partialQueue = [{ id: 'project-a', spec: { contentOrderId: 'order-a' } }];
assert.deepEqual(contentOrderCoverage(partialQueue, ['order-a', 'order-b']).missing, ['order-b']);
assert.equal(contentOrderCoverage(partialQueue, ['order-a', 'order-b']).complete, false, 'one completed project must not satisfy two frozen orders');
const repairedQueue = [...partialQueue, { id: 'project-b', spec: { contentOrderId: 'order-b' } }];
assert.equal(contentOrderCoverage(repairedQueue, ['order-a', 'order-b']).complete, true);
assert.deepEqual(contentOrderCoverage(repairedQueue, ['order-a', 'order-b']).missing, [], 'a retried queue must not recreate existing orders');
assert.equal(contentOrderCoverage([...repairedQueue, partialQueue[0]!], ['order-a', 'order-b']).complete, false);
assert.equal(contentOrderCoverage(repairedQueue, ['order-b']).complete, false, 'obsolete orders must not be silently approved');
const originalList = store.list;
try {
  const pages: number[] = [];
  store.list = (async (collection, query = {}) => {
    assert.equal(collection, 'studio_projects');
    assert.deepEqual(query.where, { tenant_id: 'pagination-test-tenant' });
    pages.push(query.page || 1);
    return { items: [{ id: query.page === 1 ? 'historical-project' : 'current-project' }], page: query.page || 1, perPage: 500, totalItems: 501, totalPages: 2 };
  }) as typeof store.list;
  assert.deepEqual((await listTenantContentProjects('pagination-test-tenant')).map(item => item.id), ['historical-project', 'current-project']);
  assert.deepEqual(pages, [1, 2], 'current-run projects beyond the first page must be found');
} finally { store.list = originalList; }

const evidence = {
  exactAnalysisIds: ['analysis-1'],
  productNames: ['Product A'],
  assetIds: ['asset-1'],
};
assert.deepEqual(selectExplicitFocusProducts([{ name: 'Product A', sku: 'A-1' }], ''), [], 'an empty focus-product selection means no current focus, not every knowledge-base product');
assert.deepEqual(selectExplicitFocusProducts([{ name: 'Product A', sku: 'A-1' }, { name: 'Product B', sku: 'B-1' }], 'B-1').map(item => item.name), ['Product B']);

const asset = (partial: Partial<AssetCandidate> & Pick<AssetCandidate, 'id' | 'name'>): AssetCandidate => ({
  type: 'image', duration: 0, observations: ['产品置于桌面'], visualObservations: ['产品置于桌面'],
  authorization: { status: 'owned', scope: 'tenant', evidence: '当前租户上传' }, synthetic: false, tags: [], source: 'enterprise_product',
  ...partial,
});

const balanced = allocateBalancedContentRoutes({
  count: 6,
  enabled: ['clone', 'product', 'material'],
  evidence,
});
assert.deepEqual(balanced.allocations, ['clone', 'product', 'material', 'clone', 'product', 'material']);

const catchesUp = allocateBalancedContentRoutes({
  count: 4,
  enabled: ['clone', 'product', 'material'],
  evidence,
  priorCounts: { clone: 5, product: 1, material: 1 },
});
assert.deepEqual(catchesUp.allocations, ['product', 'material', 'product', 'material'], 'allocation must favor historically under-used eligible routes');

const noExactAnalysis = allocateBalancedContentRoutes({
  count: 3,
  enabled: ['clone', 'product', 'material'],
  evidence: { ...evidence, exactAnalysisIds: [] },
});
assert.deepEqual(noExactAnalysis.allocations, ['product', 'material', 'product']);
assert.ok(noExactAnalysis.blockers.some(item => item.includes('全片精确分析')));

const noAssets = allocateBalancedContentRoutes({
  count: 3,
  enabled: ['clone', 'product', 'material'],
  evidence: { exactAnalysisIds: ['analysis-1'], productNames: ['Product A'], assetIds: [] },
});
assert.deepEqual(noAssets.allocations, []);
assert.ok(noAssets.blockers.some(item => item.includes('真实图片/视频')));
const gaps = contentProductionKnowledgeGaps({
  enabled: ['clone', 'product', 'material'],
  evidence: { exactAnalysisIds: [], productNames: [], assetIds: [] },
});
assert.deepEqual(gaps.map(item => item.key), ['exact_analysis', 'product', 'material']);
assert.deepEqual(gaps.map(item => item.destination), ['socialInspiration', 'enterprise', 'smartAssets']);

const productAAsset = asset({ id: 'asset-product-a', name: 'A 产品正面', productId: 'product-a', productName: 'Product A', visualObservations: ['Product A 正面包装置于桌面'], observations: ['Product A 正面包装置于桌面'], tags: ['正面包装'] });
const productBAsset = asset({ id: 'asset-product-b', name: 'B 产品产线', productId: 'product-b', productName: 'Product B', visualObservations: ['Product B 位于灌装产线'], observations: ['Product B 位于灌装产线'], tags: ['灌装产线'] });
const productADetail = asset({ id: 'asset-product-a-detail', name: 'A 产品细节', productId: 'product-a', productName: 'Product A', visualObservations: ['Product A 包装细节'], observations: ['Product A 包装细节'], tags: ['包装细节'] });
const syntheticA = asset({ id: 'asset-synthetic-a', name: 'A 占位图', productId: 'product-a', productName: 'Product A', synthetic: true });
const productScript = '[0-4s]\n环境：桌面\n镜头功能：产品证据\n画面：展示 Product A 正面包装\n台词：了解产品\n字幕：了解产品\n\n[4-8s]\n环境：桌面\n镜头功能：细节\n画面：展示正面包装\n台词：查看细节\n字幕：查看细节';
const productMatch = matchSceneSources({
  script: productScript,
  scenes: [{ start: 0, end: 4 }, { start: 4, end: 8 }],
  assets: [productBAsset, syntheticA, productAAsset], route: 'product', productId: 'product-a',
});
assert.deepEqual(productMatch.plan.map(item => item.assetId), ['asset-product-a', 'asset-product-a'], 'product path must never fill Product A scenes with Product B or synthetic assets');
assert.ok(productMatch.plan.every(item => item.reasons.some(reason => reason.includes('Product A'))), 'scene matching must retain explainable product ownership evidence');
const missingProductMatch = matchSceneSources({ script: productScript, scenes: [{ start: 0, end: 4 }], assets: [productBAsset], route: 'product', productId: 'product-a' });
assert.equal(missingProductMatch.plan.length, 0);
assert.ok(missingProductMatch.gaps[0]?.includes('本产品'), 'missing related product visuals must become an explicit gap, not a cross-product fallback');

const routePlans = buildRouteSourcePlans({
  allocations: ['material', 'product', 'material'],
  products: [{ productId: 'product-a', productName: 'Product A' }, { productId: 'product-b', productName: 'Product B' }],
  assets: [productAAsset, productADetail, productBAsset], referenceAnalysisIds: ['analysis-1'], platforms: ['tiktok', 'linkedin'],
});
assert.equal(routePlans[0]?.seedAssetId, 'asset-product-a');
assert.deepEqual(routePlans[0]?.assetIds, ['asset-product-a', 'asset-product-a-detail'], 'material route must retain its seed and add only same-product companions');
assert.equal(routePlans[1]?.productId, 'product-b', 'a later route must not reuse the material route evidence pool when another grounded product is available');
assert.ok(routePlans[2]?.gap?.includes('不会复用'), 'an exhausted batch must expose a gap instead of silently recycling prior-route assets');
assert.notEqual(routePlans[0]?.platformBrief, routePlans[1]?.platformBrief, 'platform assignments must freeze differentiated creative briefs');
assert.match(platformCreativeBrief('linkedin'), /专业决策者/);
assert.match(platformCreativeBrief('tiktok'), /前 2 秒/);
const diversifiedMaterialMatch = matchSceneSources({
  script: productScript, scenes: [{ start: 0, end: 4 }, { start: 4, end: 8 }], assets: [productAAsset, productADetail],
  route: 'material', lockedAssetIds: ['asset-product-a', 'asset-product-a-detail'], productId: 'product-a',
});
assert.equal(new Set(diversifiedMaterialMatch.plan.map(item => item.assetId)).size, 2, 'when two locked relevant assets exist, scene matching must use both before cycling one');

const duplicatedFingerprint = contentFingerprint({ route: 'product', productId: 'product-a', assetIds: ['asset-product-a'], script: productScript });
assert.deepEqual(detectContentDuplication({
  candidate: { route: 'product', productId: 'product-a', assetIds: ['asset-product-a'], script: productScript },
  existing: [{ fingerprint: duplicatedFingerprint, route: 'product', assetIds: ['asset-product-a'], script: productScript }],
}), { duplicate: true, pathDifference: false, reason: '内容证据、路径与脚本完全重复' });
assert.equal(detectContentDuplication({
  candidate: { route: 'material', productId: 'product-a', assetIds: ['asset-product-a'], script: '不同脚本' },
  existing: [{ route: 'product', assetIds: ['asset-product-a'], script: '产品脚本' }],
}).pathDifference, false, 'different routes must not masquerade as distinct work while reusing the exact same evidence set');
assert.equal(detectContentDuplication({
  candidate: { route: 'material', productId: 'product-a', assetIds: ['asset-product-a-detail'], script: '不同脚本' },
  existing: [{ route: 'product', assetIds: ['asset-product-a'], script: '产品脚本' }],
}).pathDifference, true, 'frozen orders with distinct material evidence must remain valid cross-route work');

assert.equal(containsInternalContentMarker('E2E-quality-42'), true);
assert.equal(containsInternalContentMarker('https://tenant.local.test/output'), true);
assert.equal(containsInternalContentMarker('product demo with verified bottle'), false, 'normal product demo wording is not an internal marker');
assert.equal(subtitleCuesAreSafe([{ start: 0, end: 4, text: '真实产品信息' }], 4), true);
assert.equal(subtitleCuesAreSafe([{ start: 0, end: 4, text: 'placeholder' }], 4), false, 'E2E/internal placeholder text must not leak into final subtitles');
const longSubtitle = '这是一个用于验证超长口播会按照视觉语义单元拆分而不会让整条成片在最终字幕质检阶段失败的真实业务句子，并且仍然保留全部原始信息。';
assert.ok(splitSubtitleUnits(longSubtitle).every(item => item.length <= 36), 'long spoken sentences must be paginated into readable subtitle units');
assert.equal(subtitleCuesAreSafe(proportionalCues(longSubtitle, 8), 8), true, 'generated caption pagination must pass the final subtitle safety gate');

const sceneRanges = [{ start: 0, end: 4 }, { start: 4, end: 12 }, { start: 12, end: 20 }];
for (const voiceoverDur of [24.72, 20.08, 18, 20]) {
  const timing = productionTiming({ duration: 20, voiceoverDur }, sceneRanges);
  assert.equal(timing.duration, Math.max(20, voiceoverDur));
  assert.ok(Math.abs(timing.sceneDurations.reduce((a, b) => a + b, 0) - timing.duration) < 1e-9);
  assert.equal(timing.sceneDurations[1] / timing.sceneDurations[0], 2, 'preserve relative scene pacing');
  assert.equal(subtitleCuesAreSafe(proportionalCues(longSubtitle, voiceoverDur), timing.duration), true);
}
assert.equal(subtitleCuesAreSafe(proportionalCues(longSubtitle, 24.72), 20), false, 'the gate must still reject genuinely truncated subtitles');
assert.equal(productionTiming({ voiceoverDur: NaN }, sceneRanges).duration, 20);
assert.throws(() => productionTiming({ duration: 20 }, [{ start: 2, end: 1 }]), /invalid_scene_timing/);

const tickSelection = selectContentProjectsForTick([
  { id: 'script-1', stage: 'script', retryable: true },
  { id: 'script-2', stage: 'script', retryable: true },
  { id: 'render-1', stage: 'render', retryable: true },
]);
assert.deepEqual(tickSelection.map(item => item.id), ['script-1', 'render-1'], 'one tick may progress two projects but must serialize uniqueness-sensitive script generation');

const retryNow = '2026-09-04T08:00:00.000Z';
const blockedProject = {
  id: 'project-blocked',
  spec: {
    workflowRunId: 'run-1',
    workflowTaskId: 'task-content',
    selectedMaterialIds: ['real-material-1'],
    renderOutputPath: '/preserved/render.mp4',
    automation: {
      managedBy: 'digital_employee', stage: 'blocked', resumeStage: 'material_match',
      retryAfter: '2026-09-04T08:15:00.000Z', blocker: '脚本服务暂时不可用',
      renderOutputPath: '/preserved/render.mp4', quality: { passed: true },
    },
  },
};
const resumedProjectSpec = resumeContentProjectForTaskControl({ project: blockedProject, runId: 'run-1', affectedTaskIds: new Set(['task-content']), now: retryNow });
assert.ok(resumedProjectSpec, 'an explicit retry must select the blocked project from the same run/task lineage');
const resumedAutomation = (resumedProjectSpec!.automation || {}) as Record<string, unknown>;
assert.equal(resumedAutomation.stage, 'material_match');
assert.equal(resumedAutomation.retryAfter, undefined, 'the 15-minute backoff must be removed immediately');
assert.equal(resumedAutomation.resumeStage, undefined);
assert.equal(resumedAutomation.blocker, undefined);
assert.deepEqual(resumedProjectSpec!.selectedMaterialIds, ['real-material-1'], 'retry must preserve selected real materials');
assert.equal(resumedProjectSpec!.renderOutputPath, '/preserved/render.mp4', 'retry must preserve existing internal render evidence');
assert.equal(resumedAutomation.renderOutputPath, '/preserved/render.mp4');
assert.equal(resumeContentProjectForTaskControl({ project: blockedProject, runId: 'other-run', affectedTaskIds: new Set(['task-content']), now: retryNow }), null, 'retry must not mutate another run');
assert.equal(resumeContentProjectForTaskControl({ project: blockedProject, runId: 'run-1', affectedTaskIds: new Set(['other-task']), now: retryNow }), null, 'retry must not mutate another task');
assert.equal(contentProjectBlockIsSemanticallyUnchanged({
  automation: { stage: 'blocked', status: 'blocked', resumeStage: 'script', blocker: 'Request timed out.', retryAfter: '2026-09-04T08:15:00.000Z' },
  resumeStage: 'script',
  reason: 'Request timed out.',
}), true, 'retry timestamps must not turn an identical blocker into a new business progress event');
assert.equal(contentProjectBlockIsSemanticallyUnchanged({
  automation: { stage: 'render', status: 'queued' }, resumeStage: 'render', reason: '渲染失败',
}), false);

assert.deepEqual(
  hardScriptSafetyIssues('台词：支持100瓶起订。', '产品：真实产品；MOQ：１００　瓶起订'),
  [],
  'digital-employee numeric claims must accept equivalent full-width and whitespace-separated MOQ evidence',
);
assert.deepEqual(
  hardScriptSafetyIssues('[0-4s]\n景别：特写持续0.5秒\n运镜：24帧慢放\n剪辑：30fps，0.5s淡出\n配乐：音乐淡出，留0.5秒静音', '产品：真实产品'),
  [],
  'storyboard timing, frame count and fps are production parameters rather than product claims',
);
const strictBusinessNumbers = hardScriptSafetyIssues(
  '台词：3秒见效，支持100瓶起订。\n画面：瓶身标注500ml。',
  '产品：真实产品',
);
assert.ok(strictBusinessNumbers.some(item => /3秒/.test(item)), 'spoken efficacy timing must remain a strict product claim');
assert.ok(strictBusinessNumbers.some(item => /100瓶/.test(item)), 'MOQ must remain strict');
assert.ok(strictBusinessNumbers.some(item => /500ml/i.test(item)), 'visual product specifications must remain strict');
assert.equal(automatedContentQualityNeedsRevalidation({
  managedBy: 'digital_employee', stage: 'completed', quality: { passed: true },
}), true, 'legacy completed projects must not reuse an unversioned quality pass');
assert.equal(automatedContentQualityNeedsRevalidation({
  managedBy: 'digital_employee', stage: 'completed', quality: { passed: true, ruleVersion: CONTENT_SCRIPT_QUALITY_RULE_VERSION },
}), false);
const groundedRepair = assessScriptQualityV2({
  script: '[0-4s]\n素材：产品图\n环境：桌面\n景别：特写\n运镜：固定\n构图：瓶身居中\n镜头功能：产品证据\n画面：标签已有 FOR SENSITIVE SKIN 与 MOQ 字样，并展示二维码、邮箱和品牌VI\n配乐：轻节奏\n台词：高纯度配方符合美国市场基础合规要求。\n字幕：高纯度配方符合美国市场基础合规要求。',
  productInfo: '产品：真实产品；MOQ：100 瓶起订',
  materialsText: '真实产品瓶体置于桌面；未观察到文字、二维码、邮箱、VI 或认证标识',
  materialInfos: [{ name: '产品图', targetStart: 0, targetEnd: 4, observations: ['真实产品瓶体置于桌面'] }],
});
assert.equal(groundedRepair.qualityStatus, 'warning');
assert.doesNotMatch(groundedRepair.script, /高纯度|美国市场基础合规|FOR SENSITIVE SKIN|MOQ 字样|二维码|邮箱|品牌VI/i);
const genericObservationRepair = assessScriptQualityV2({
  script: '[0-4s]\n环境：柔光棚\n景别：特写\n运镜：绕瓶旋转\n构图：3–5瓶整齐排列\n镜头功能：展示产品\n画面：瓶身整体形态、液体质感与英文标签\n配乐：轻节奏\n台词：了解详情请私信\n字幕：了解详情请私信',
  productInfo: '产品：积雪草舒缓精华',
  materialsText: '企业知识库产品“积雪草舒缓精华”的已上传图片',
  materialInfos: [{ name: 'centella-owned.png', targetStart: 0, targetEnd: 4, observations: ['企业知识库产品“积雪草舒缓精华”的已上传图片'] }],
});
assert.notEqual(genericObservationRepair.qualityStatus, 'rejected');
assert.match(genericObservationRepair.script, /原样展示已选素材/);
assert.doesNotMatch(genericObservationRepair.script, /瓶身整体|液体质感|英文标签|3–5瓶|绕瓶旋转/, 'generic upload evidence must not support detailed objects, labels, quantities, or camera actions');

assert.equal(isLlmUnavailableError(new Error('gemini LLM request timed out after 90s')), true);
assert.equal(isLlmUnavailableError(new Error('GEMINI_API_KEY not set')), true);
assert.equal(isLlmUnavailableError(new Error('脚本事实质检失败')), false, 'fact failures must not be hidden behind fallback generation');
const fallbackAssets = [asset({
  id: 'real-product-image', name: '真实产品图', productId: 'product-a', productName: '真实产品',
  observations: ['真实产品瓶体置于桌面'], visualObservations: ['真实产品瓶体置于桌面'],
})];
const fallbackScript = deterministicClosedWorldStoryboard({
  productFacts: '产品：真实产品；MOQ：100 瓶起订',
  assets: fallbackAssets,
});
assert.equal(fallbackScript.match(/^\[\d+-\d+s\]$/gm)?.length, 5, 'fallback must always produce exactly five continuous storyboard scenes');
assert.doesNotMatch(fallbackScript, /高纯度|合规要求|FOR SENSITIVE SKIN|二维码|邮箱|品牌VI/i, 'fallback must not invent unsupported product or visual facts');
const fallbackRanges = [0, 4, 8, 12, 16].map(start => ({ name: '真实产品图', targetStart: start, targetEnd: start + 4, observations: ['真实产品瓶体置于桌面'] }));
const fallbackQuality = assessScriptQualityV2({
  script: fallbackScript,
  productInfo: '产品：真实产品；MOQ：100 瓶起订',
  materialsText: '真实产品瓶体置于桌面',
  materialInfos: fallbackRanges,
  primaryCta: '私信获取方案',
});
assert.notEqual(fallbackQuality.qualityStatus, 'rejected', `fallback must pass hard factual safety: ${fallbackQuality.hardIssues.join('；')}`);
assert.notEqual(fallbackQuality.qualityStatus, 'needs_material', `fallback must remain executable with the bound real asset: ${fallbackQuality.warnings.join('；')}`);

const enterpriseAssetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'enterprise-asset-render-'));
try {
  const tenantId = 'tenant/product-render';
  const tenantDir = path.join(enterpriseAssetRoot, enterpriseAssetTenantKey(tenantId));
  fs.mkdirSync(tenantDir, { recursive: true });
  const filePath = path.join(tenantDir, 'real-product.png');
  fs.writeFileSync(filePath, Buffer.from('real-product-image-bytes'));
  const localLocation = resolveEnterpriseAssetLocation('/api/overseas/enterprise/assets/real-product.png', tenantId, { assetsDir: enterpriseAssetRoot, objectStorage: false });
  assert.equal(localLocation.localPath, filePath, 'enterprise product assets must resolve within the current tenant directory');
  assert.match(await assetRenderUrl(asset({ id: 'product-image', name: '真实产品图', observations: [], visualObservations: [], ...localLocation }), tenantId), /^data:image\/png;base64,/, 'a local enterprise product upload must become a render-readable data URL');

  const objectLocation = resolveEnterpriseAssetLocation('/api/overseas/enterprise/assets/remote-product.mp4', tenantId, { assetsDir: enterpriseAssetRoot, objectStorage: true });
  assert.equal(objectLocation.objectKey, enterpriseAssetObjectKey(tenantId, 'remote-product.mp4'), 'object-storage fallback must remain tenant scoped');
  assert.deepEqual(resolveEnterpriseAssetLocation('/api/overseas/enterprise/assets/mock-product.png', tenantId, { assetsDir: enterpriseAssetRoot, objectStorage: false }), {}, 'mock product assets must remain ineligible');
  assert.deepEqual(resolveEnterpriseAssetLocation('/api/overseas/enterprise/assets/..%2Fother-tenant.png', tenantId, { assetsDir: enterpriseAssetRoot, objectStorage: false }), {}, 'encoded cross-directory paths must not resolve');
} finally {
  fs.rmSync(enterpriseAssetRoot, { recursive: true, force: true });
}

const visualQualityRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'render-visual-quality-'));
try {
  assert.ok(ffmpegStatic, 'visual quality regression requires ffmpeg-static');
  const solid = path.join(visualQualityRoot, 'solid.mp4');
  const content = path.join(visualQualityRoot, 'content.mp4');
  execFileSync(String(ffmpegStatic), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x141A2E:s=320x480:r=10:d=4', '-pix_fmt', 'yuv420p', '-y', solid]);
  execFileSync(String(ffmpegStatic), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x480:r=10:d=4', '-pix_fmt', 'yuv420p', '-y', content]);
  const solidQuality = await inspectRenderedVisuals({ outputPath: solid, expectedDuration: 4, evidenceDir: path.join(visualQualityRoot, 'solid-evidence') });
  assert.equal(solidQuality.passed, false, 'a valid MP4 containing only the renderer fallback color must fail visual quality');
  assert.ok(solidQuality.failures.some(item => item.includes('单色')));
  const contentQuality = await inspectRenderedVisuals({ outputPath: content, expectedDuration: 4, evidenceDir: path.join(visualQualityRoot, 'content-evidence') });
  assert.equal(contentQuality.passed, true, contentQuality.failures.join('；'));
  assert.ok(contentQuality.metrics.meanEdgeRatio > solidQuality.metrics.meanEdgeRatio, 'real visual content must carry more edge information than a fallback frame');
  assert.ok(contentQuality.metrics.maxFrameDifference > 0, 'frame-difference evidence must be measured');
  assert.equal(contentQuality.evidenceFrames.length, 5, 'quality review must retain representative extracted frames');
} finally {
  fs.rmSync(visualQualityRoot, { recursive: true, force: true });
}

const root = process.cwd();
const routeSource = fs.readFileSync(path.join(root, 'server/routes/digitalEmployees.ts'), 'utf8');
const executorSource = fs.readFileSync(path.join(root, 'server/digitalEmployees/contentProduction.ts'), 'utf8');
assert.match(routeSource, /advanceAutomatedContentProduction\(/, 'runtime reconciliation must actively invoke content production');
assert.match(routeSource, /studioProjectRendered/, 'production must wait for a rendered artifact rather than any draft project');
assert.match(routeSource, /automation\.quality/, 'quality gate must require the persisted automated quality result');
assert.match(routeSource, /contentKnowledgeGaps/, 'an all-inputs-missing run must persist a typed knowledge gap on the workflow task');
assert.match(routeSource, /supersedeAffectedBusinessState[\s\S]*?resumeContentProjectForTaskControl/, 'task retry/replan must clear the matching automated Studio project backoff');
assert.match(routeSource, /applyTaskControl\([\s\S]*?await advanceRun\(tenantId, result\.runId\)/, 'the retry endpoint must reconcile the run immediately after clearing project backoff');
assert.match(executorSource, /managedBy:\s*'digital_employee'/, 'created Studio projects must remain traceable to the digital employee');
assert.match(executorSource, /产品事实与视觉素材证据严格分离/, 'generation must explicitly separate structured product facts from visible material evidence');
assert.match(executorSource, /二维码、邮箱、VI/, 'generation must forbid unsupported labels and contact/identity visuals');
assert.match(executorSource, /fs\.existsSync\(result\.outputPath\)/, 'render stage must verify a real output file');
assert.match(executorSource, /inspectRenderedVisuals/, 'quality stage must decode representative frames rather than trusting file existence');
assert.match(executorSource, /requireVisualAssets:\s*true/, 'automated rendering must not downgrade missing bound assets to a solid background');
assert.doesNotMatch(executorSource, /status:\s*'completed'[\s\S]{0,160}placeholder|placeholder[\s\S]{0,160}status:\s*'completed'/i, 'placeholder media must never complete an automated project');

console.log('digital employee content production tests passed');

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const previous = {
  cwd: process.cwd(),
  NODE_ENV: process.env.NODE_ENV,
  DASHSCOPE_API_KEY: process.env.DASHSCOPE_API_KEY,
  MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
  MINIMAX_API_TOKEN: process.env.MINIMAX_API_TOKEN,
};
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-social-auto-render-'));
process.chdir(temporaryRoot);
process.env.NODE_ENV = 'test';
delete process.env.DASHSCOPE_API_KEY;
delete process.env.MINIMAX_API_KEY;
delete process.env.MINIMAX_API_TOKEN;

try {
  const [
    { INTERNAL_SOCIAL_CONTENT_FORMULAS },
    { freezeSocialScriptBaseline, parseStoredSocialScriptBaseline, verifiedSocialScriptContext },
    {
      buildSocialProductionPlan,
    },
    {
      buildSocialDirectorPlan,
      socialDirectorContentHandoff,
      socialDirectorRenderTimeline,
      socialDirectorSceneTimingCues,
    },
    { matchSocialInspirationScript },
    {
      applySocialReviewRevision,
      applyZeroAssetTruthSafeNarration,
      automaticSocialMaterialEligible,
      detectDistinctTaskVideoSegments,
      hasExactTaskProductAssociation,
      socialReviewRevisionDirective,
      systemThemeGraphicAssets,
    },
    { synthesizeStudioVoiceForAutomation },
    { inspectRenderedScenes, inspectRenderedVisuals, runVisualFfmpeg },
  ] = await Promise.all([
    import('./socialContentThemes.js'),
    import('./socialContentScriptBaseline.js'),
    import('./socialContentProductionPlan.js'),
    import('./socialContentDirectorPlan.js'),
    import('./socialContentScriptSources.js'),
    import('./socialContentAutoProduction.js'),
    import('../routes/studio.js'),
    import('../lib/renderVisualQuality.js'),
  ]);
  const require = createRequire(import.meta.url);
  const { composite } = require('../../desktop/render.cjs') as {
    composite: (manifest: unknown, onProgress?: (progress: number) => void, outputDir?: string) => Promise<{ ok: boolean; outputPath?: string; error?: string }>;
  };

  const lockedAt = '2026-09-20T08:00:00.000Z';
  const formula = {
    recordId: 'governed-formula-record',
    formulaId: 'test.product-proof', version: '1.0.0', name: '测试产品编导公式',
    themeId: 'product_value' as const, status: 'active' as const,
    rollout: { percentage: 100, tenantAllowlist: [] as string[] },
    audit: [{ event: 'published_active', actor: 'test-admin', at: lockedAt }],
    direction: {
      pace: 'balanced' as const,
      music: { mood: '清晰、专业', volume: 18 },
      voiceover: { voice: 'v1', preset: 'professional_b2b' as const, speed: 1.12, pauseStyle: 'natural' as const },
      subtitles: { fontScale: 1, bottomRatio: 0.18 },
    },
    nodes: [
      ['overview', '建立产品认知', '产品全貌', '完整展示'],
      ['detail', '证明关键卖点', '关键结构或原料', '近景展示'],
      ['demo', '展示使用效果', '产品与使用对象', '真实演示'],
      ['evidence', '提供可核验证据', '检测参数或对比证据', '清晰呈现'],
    ].map(([nodeId, shotFunction, subject, action]) => ({
      nodeId: nodeId!, shotFunction: shotFunction!, subject: subject!, action: action!,
      environment: null, orientation: 'portrait' as const,
      durationSeconds: { minimum: 2, maximum: 8 }, required: true,
      narrationTemplate: { zh: `通过真实素材展示${subject}。`, en: `Show ${subject} through real material.` },
    })),
  };
  assert.deepEqual(INTERNAL_SOCIAL_CONTENT_FORMULAS, [], 'formula registry ships empty until an administrator configures it');
  const forbiddenUserText = '把我输入的这一整段文字直接念出来绝对不合理';
  const baseline = freezeSocialScriptBaseline({
    brief: {
      title: forbiddenUserText, objective: forbiddenUserText, productRef: forbiddenUserText, audience: '采购商',
      markets: ['中国'], languages: ['中文'], platforms: ['抖音'], formats: ['短视频'], aspectRatio: '9:16',
      cadence: null, requestedOutputCount: 1, dueAt: null, brandNotes: null, restrictions: ['不得虚构功效'],
      callToAction: forbiddenUserText,
    },
    theme: { themeId: 'product_value', inputKind: 'custom', topic: forbiddenUserText, classificationStatus: 'confirmed' },
    formula,
    verifiedContext: {
      productName: '已确认测试护肤品',
      facts: [{ key: 'material', label: '材质', value: '已确认配方信息' }],
      source: 'enterprise_product',
      confidence: 1,
    },
    lockedAt,
  });
  assert.equal(baseline.lockedAt, lockedAt);
  assert.equal(baseline.source, 'formula');
  assert.ok(baseline.scenes.every(scene => scene.narration.length > 0));
  assert.doesNotMatch(baseline.scenes.map(scene => scene.narration).join(''), new RegExp(forbiddenUserText));
  assert.equal(baseline.match?.userTextUsage, 'intent_only');

  const inspiration = matchSocialInspirationScript({
    themeId: 'product_value',
    verifiedContext: { productName: '已确认测试护肤品', facts: [], source: 'enterprise_product', confidence: 1 },
    records: [{
      id: 'inspiration-1', title: '护肤产品细节实拍', tags: ['产品', '细节'],
      aiAnalysis: JSON.stringify({
        analysisMode: 'exact', analysisQuality: 'video',
        gemini: { theme: '产品卖点', scriptDetails15s: [
          { time: '0-3', purpose: '产品开场', visual: '瓶身实拍', confidence: 0.9 },
          { time: '3-6', purpose: '细节证明', visual: '包装细节', confidence: 0.88 },
        ] },
      }),
    }],
  });
  assert.equal(inspiration?.recordId, 'inspiration-1');
  assert.ok((inspiration?.confidence ?? 0) >= 0.58);

  const fallbackBaseline = freezeSocialScriptBaseline({
    brief: {
      title: forbiddenUserText, objective: forbiddenUserText, productRef: forbiddenUserText, audience: null,
      markets: ['中国'], languages: ['中文'], platforms: ['抖音'], formats: ['短视频'], aspectRatio: '9:16',
      cadence: null, requestedOutputCount: 1, dueAt: null, brandNotes: null, restrictions: [], callToAction: forbiddenUserText,
    },
    theme: { themeId: 'product_value', inputKind: 'custom', topic: forbiddenUserText, classificationStatus: 'confirmed' },
    formula: { ...formula, recordId: undefined },
    verifiedContext: {
      productName: '知识库产品', facts: [{ key: 'material', label: '材质', value: '已确认材质' }],
      source: 'enterprise_product', confidence: 1,
    },
    lockedAt,
  });
  assert.equal(fallbackBaseline.source, 'knowledge_fallback', 'generic built-ins are safety skeletons, not matched viral formulas');
  assert.doesNotMatch(fallbackBaseline.scenes.map(scene => scene.narration).join(''), new RegExp(forbiddenUserText));
  assert.doesNotMatch(fallbackBaseline.scenes.map(scene => scene.narration).join(''), /用户明确关联|user-linked material/i,
    'verified knowledge without a linked material must never invent a user material association');
  const noVisualPlan = buildSocialProductionPlan({ baseline: fallbackBaseline, assets: [] });
  assert.equal(noVisualPlan.ok, false);
  assert.equal(noVisualPlan.reasonCode, 'no_visual_material', 'text cards can never replace the visual body of a deliverable video');
  const unmatchedProductContext = verifiedSocialScriptContext({
    company: { industry: '美妆代工' },
    products: {
      categories: '护肤与洗护',
      items: [{ name: '企业知识中的另一款产品', sku: 'KNOWN-001', category: '护肤' }],
    },
  } as never, '用户上传视频里的新产品');
  assert.equal(unmatchedProductContext.source, 'none',
    'company profile facts must not be promoted to facts about an unmatched task product');

  const systemBaseline = freezeSocialScriptBaseline({
    brief: {
      title: forbiddenUserText, objective: forbiddenUserText, productRef: null, audience: null,
      markets: ['中国'], languages: ['中文'], platforms: ['抖音'], formats: ['短视频'], aspectRatio: '9:16',
      cadence: null, requestedOutputCount: 1, dueAt: null, brandNotes: null, restrictions: [], callToAction: forbiddenUserText,
    },
    theme: { themeId: 'product_value', inputKind: 'preset', topic: forbiddenUserText, classificationStatus: 'confirmed' },
    verifiedContext: { productName: null, facts: [], source: 'none', confidence: 0 },
    lockedAt,
  });
  assert.equal(systemBaseline.source, 'system_theme_baseline');
  assert.equal(systemBaseline.match?.strategy, 'system_theme_baseline');
  assert.doesNotMatch(systemBaseline.scenes.map(scene => scene.narration).join(' '), new RegExp(forbiddenUserText),
    'the zero-input baseline uses controlled platform copy and never promotes free-form input to a claim');
  assert.match(systemBaseline.scenes.map(scene => scene.narration).join(' '), /别急着划走|细节自己说话/,
    'the safe product fallback should still read like social product promotion');
  const systemGraphicDirectory = path.join(temporaryRoot, 'system-graphics');
  fs.mkdirSync(systemGraphicDirectory, { recursive: true });
  const systemAssets = await systemThemeGraphicAssets({
    outputDirectory: systemGraphicDirectory,
    baseline: systemBaseline,
  });
  assert.equal(systemAssets.every(asset => asset.localPath && fs.existsSync(asset.localPath)), true,
    'the no-material fallback creates real renderable image files');
  const systemPlan = buildSocialProductionPlan({ baseline: systemBaseline, assets: systemAssets });
  assert.equal(systemPlan.ok, true, systemPlan.message);
  assert.equal(systemPlan.scenes.length, 4);
  const safeSystemPlan = applyZeroAssetTruthSafeNarration(systemPlan);
  assert.doesNotMatch(safeSystemPlan.scenes.map(scene => scene.narration).join(' '), /真实上手|真实场景|拍清楚|拍给你看|one real look|real scenario/i,
    'zero-asset narration must not describe generated cards as real footage or a real scenario');
  const systemDirectorPlan = buildSocialDirectorPlan({
    taskId: 'zero-input-system-theme-test',
    baseline: systemBaseline,
    productionPlan: safeSystemPlan,
    productionAssets: systemAssets,
    sourceVersions: Object.fromEntries(systemAssets.map(asset => [asset.sourceId, asset.contentHash || 'generated-system-graphic'])),
    outputSpec: { aspectRatio: '9:16', resolution: '720p', platform: 'douyin' },
    bgmSelection: {
      primary: {
        trackId: 'test-authorized-bgm', name: '测试授权配乐', mood: '专业',
        authorization: {
          status: 'authorized', basis: 'tenant_uploaded_warranty',
          license: '测试授权', evidence: 'test-catalog:test-authorized-bgm',
        },
      },
      fallbacks: [], fallbackPolicy: 'ordered_preapproved_tracks_only', volume: 0,
    },
    formula: null,
    createdAt: lockedAt,
  });
  assert.equal(systemDirectorPlan.status, 'ready');
  assert.equal(systemDirectorPlan.qualityGates.find(gate => gate.gateId === 'script_grounding')?.status, 'passed');
  assert.equal(systemDirectorPlan.materialSnapshot.every(asset => asset.selectionOrigin === 'system_graphic'), true);

  assert.equal(automaticSocialMaterialEligible({ id: 'owned', type: 'image', tenantId: 'tenant-a' } as never, 'tenant-a'), true);
  assert.equal(automaticSocialMaterialEligible({ id: 'other', type: 'image', tenantId: 'tenant-b' } as never, 'tenant-a'), false);
  assert.equal(automaticSocialMaterialEligible({
    id: 'shared-without-rights', type: 'video', scope: 'shared', commercialUseApproved: true,
  } as never, 'tenant-a'), false, 'shared inventory fails closed without derivative rights and license evidence');
  assert.equal(automaticSocialMaterialEligible({
    id: 'shared-authorized', type: 'video', scope: 'shared', commercialUseApproved: true,
    derivativesApproved: true, licenseEvidence: 'license-record-1',
  } as never, 'tenant-a'), true);
  assert.equal(automaticSocialMaterialEligible({
    id: 'shared-reference-only', type: 'video', scope: 'shared', usage: 'reference_only', commercialUseApproved: true,
    derivativesApproved: true, licenseEvidence: 'license-record-2',
  } as never, 'tenant-a'), false);

  const associationBrief = {
    title: forbiddenUserText, objective: forbiddenUserText, productRef: 'Meno Moso 损伤发质洗护', audience: null,
    markets: ['中国'], languages: ['中文'], platforms: ['抖音'], formats: ['短视频'], aspectRatio: '9:16',
    cadence: null, requestedOutputCount: 1, dueAt: null, brandNotes: null, restrictions: [], callToAction: null,
  };
  const associationBaseline = freezeSocialScriptBaseline({
    brief: associationBrief,
    theme: { themeId: 'product_value', inputKind: 'custom', topic: forbiddenUserText, classificationStatus: 'confirmed' },
    verifiedContext: { productName: null, facts: [], source: 'none', confidence: 0 },
    userProductAssociation: { basis: 'tenant_task_upload', confidence: 0.45 },
    materialCategoryHint: 'damaged hair shampoo and hair treatment mask',
    lockedAt,
  });
  const associationNarration = associationBaseline.scenes.map(scene => scene.narration).join(' ');
  const parsedAssociationBaseline = parseStoredSocialScriptBaseline(JSON.stringify(associationBaseline));
  assert.equal(String(parsedAssociationBaseline?.match?.verifiedKnowledgeSource), 'user_product_association');
  assert.equal(parsedAssociationBaseline?.match?.userProductAssociation?.basis, 'tenant_task_upload');
  assert.match(associationNarration, /洗护别随便选|认真护发/,
    'a hair-care product association should select governed promotional copy without copying the product reference');
  assert.doesNotMatch(associationNarration, /Meno Moso|损伤发质洗护/,
    'the product reference only selects an allowlisted copy profile and is never copied into speech');
  assert.doesNotMatch(associationNarration, /联系我们|Contact us/i,
    'an absent CTA must remain absent instead of inventing a contact-us instruction');
  assert.doesNotMatch(associationNarration, /素材中实际可见|画面中清晰可见|视觉模型确认/,
    'an upload association must not be described as a visual observation');

  const unverifiedCategoryBaseline = freezeSocialScriptBaseline({
    brief: { ...associationBrief, productRef: '日常护肤精华' },
    theme: { themeId: 'product_value', inputKind: 'preset', topic: '产品卖点', classificationStatus: 'confirmed' },
    verifiedContext: { productName: null, facts: [], source: 'none', confidence: 0 },
    userProductAssociation: { basis: 'tenant_task_upload', confidence: 0.45 },
    lockedAt,
  });
  const unverifiedCategoryNarration = unverifiedCategoryBaseline.scenes.map(scene => scene.narration).join(' ');
  assert.match(unverifiedCategoryNarration, /真实上手|同类产品/);
  assert.doesNotMatch(unverifiedCategoryNarration, /护肤品|日常护肤/,
    'a novice product label cannot override the visual category when no material analysis supports it');

  const skincareBaseline = freezeSocialScriptBaseline({
    brief: { ...associationBrief, productRef: '日常护肤精华' },
    theme: { themeId: 'product_value', inputKind: 'preset', topic: '产品卖点', classificationStatus: 'confirmed' },
    verifiedContext: { productName: null, facts: [], source: 'none', confidence: 0 },
    userProductAssociation: { basis: 'tenant_task_upload', confidence: 0.45 },
    materialCategoryHint: 'skincare serum and cream texture',
    lockedAt,
  });
  assert.match(skincareBaseline.scenes.map(scene => scene.narration).join(' '), /真实质地|日常护肤/,
    'a novice skincare task receives governed social-selling copy instead of a generic audit script');
  const makeupBaseline = freezeSocialScriptBaseline({
    brief: { ...associationBrief, productRef: '雾面口红彩妆' },
    theme: { themeId: 'product_value', inputKind: 'preset', topic: '产品卖点', classificationStatus: 'confirmed' },
    verifiedContext: { productName: null, facts: [], source: 'none', confidence: 0 },
    userProductAssociation: { basis: 'tenant_task_upload', confidence: 0.45 },
    materialCategoryHint: 'makeup lipstick application',
    lockedAt,
  });
  assert.match(makeupBaseline.scenes.map(scene => scene.narration).join(' '), /真实上手|细节自己说话/);

  const configuredCtaBaseline = freezeSocialScriptBaseline({
    brief: { ...associationBrief, callToAction: '查看企业资料页' },
    theme: { themeId: 'product_value', inputKind: 'custom', topic: forbiddenUserText, classificationStatus: 'confirmed' },
    verifiedContext: { productName: null, facts: [], source: 'none', confidence: 0 },
    userProductAssociation: { basis: 'tenant_task_upload', confidence: 0.45 },
    lockedAt,
  });
  assert.doesNotMatch(configuredCtaBaseline.scenes.map(scene => scene.narration).join(' '), /联系我们|Contact us/i,
    'the safe fallback never replaces a configured intent with an invented contact-us CTA');
  assert.doesNotMatch(configuredCtaBaseline.scenes.map(scene => scene.narration).join(' '), /查看企业资料页/,
    'free-form CTA remains intent-only unless a governed formula explicitly places its CTA token');

  assert.equal(hasExactTaskProductAssociation({
    id: 'material-exact', productRefs: ['  PRODUCT:CURRENT  '], productName: 'untrusted display name',
  }, 'product:current'), true);
  assert.equal(hasExactTaskProductAssociation({
    id: 'material-label-only', productName: 'product:current', name: 'product:current',
  }, 'product:current'), false, 'display names and filenames cannot establish current-product provenance');
  assert.equal(hasExactTaskProductAssociation({
    id: 'material-other-product', productRefs: ['product:other'],
  }, 'product:current'), false);

  const associatedAssets = ['association-a', 'association-b'].map((id, index) => ({
    id, name: `用户关联素材 ${index + 1}`, type: 'image' as const, sourceId: `source-${id}`,
    url: `data:image/png;base64,${index === 0 ? 'AA==' : 'AQ=='}`,
    contentHash: `independent-content-${index + 1}`,
    duration: 0,
    visualObservations: [],
    segments: [],
    explicitProductAssociation: {
      productRef: 'Meno Moso 损伤发质洗护', basis: 'tenant_task_upload' as const, exactTaskProductMatch: true as const,
    },
  }));
  const associationPlan = buildSocialProductionPlan({ baseline: associationBaseline, assets: associatedAssets });
  assert.equal(associationPlan.ok, true, associationPlan.message);
  assert.deepEqual(associationPlan.selectedAssetIds.sort(), ['association-a', 'association-b']);
  assert.equal(associationPlan.averageConfidence, 0,
    'association-only production must not manufacture visual confidence');
  assert.equal(associationPlan.scenes.every(scene => /[。！？]$/.test(scene.narration)), true,
    'limited-material narration must remain a complete Chinese sentence');
  assert.doesNotMatch(associationPlan.scenes.map(scene => scene.narration).join(''), /的已。|用户明确关联到本次。/,
    'duration fitting must never cut a Chinese phrase in the middle');
  assert.equal(associationPlan.scenes.every(scene => scene.clip.needsReview
    && scene.clip.evidenceBasis === 'user_product_association'
    && scene.clip.confidence === 0), true,
  'association-only clips remain explicitly unreviewed visual evidence');

  const verifiedKnowledgeAssociationBaseline = freezeSocialScriptBaseline({
    brief: associationBrief,
    theme: { themeId: 'product_value', inputKind: 'custom', topic: forbiddenUserText, classificationStatus: 'confirmed' },
    verifiedContext: {
      productName: '已确认玻尿酸精华液',
      facts: [{ key: 'material', label: '产品资料', value: '企业知识库已核验' }],
      source: 'enterprise_product',
      confidence: 1,
    },
    userProductAssociation: { basis: 'tenant_task_upload', confidence: 0.45 },
    lockedAt,
  });
  const verifiedKnowledgeAssociationPlan = buildSocialProductionPlan({
    baseline: verifiedKnowledgeAssociationBaseline,
    assets: associatedAssets,
  });
  assert.equal(verifiedKnowledgeAssociationPlan.ok, true, verifiedKnowledgeAssociationPlan.message);
  assert.equal(verifiedKnowledgeAssociationPlan.scenes.every(scene => scene.clip.needsReview
    && scene.clip.evidenceBasis === 'user_product_association'
    && scene.clip.confidence === 0), true,
  'verified enterprise facts may use exact product-linked files without manufacturing visual confidence');
  assert.doesNotMatch(verifiedKnowledgeAssociationPlan.scenes.map(scene => scene.narration).join(' '),
    /画面中清晰可见|视觉模型确认/,
    'enterprise knowledge and exact product linkage must not be restated as a visual observation');

  const associationDirectorPlan = buildSocialDirectorPlan({
    taskId: 'association-safe-director-test',
    baseline: associationBaseline,
    productionPlan: associationPlan,
    productionAssets: associatedAssets,
    sourceVersions: Object.fromEntries(associatedAssets.map(asset => [asset.sourceId, 'source-version-1'])),
    outputSpec: { aspectRatio: '9:16', resolution: '720p', platform: 'douyin' },
    bgmSelection: {
      primary: {
        trackId: 'test-authorized-bgm', name: '测试授权配乐', mood: '专业',
        authorization: {
          status: 'authorized', basis: 'tenant_uploaded_warranty',
          license: '企业上传时确认拥有使用权', evidence: 'test-catalog:test-authorized-bgm',
        },
      },
      fallbacks: [], fallbackPolicy: 'ordered_preapproved_tracks_only', volume: 0,
    },
    formula: null,
    createdAt: lockedAt,
  });
  assert.equal(associationDirectorPlan.status, 'ready');
  assert.equal(associationDirectorPlan.qualityGates.find(gate => gate.gateId === 'script_grounding')?.status, 'passed');
  assert.equal(associationDirectorPlan.qualityGates.find(gate => gate.gateId === 'material_confidence')?.status, 'warning');
  assert.equal(associationDirectorPlan.scenes.every(scene => scene.shotPlan.confidence === 0
    && scene.materialMapping.observations.every(observation => /未经视觉模型识别/.test(observation))), true);

  const oneAssociationOnly = buildSocialProductionPlan({
    baseline: associationBaseline,
    assets: [associatedAssets[0]!, {
      ...associatedAssets[1]!, explicitProductAssociation: undefined,
      // A label that sounds relevant still cannot replace provenance.
      userProvidedObservations: ['用户确认关联：product:current'],
    }],
  });
  assert.equal(oneAssociationOnly.ok, false);
  assert.equal(oneAssociationOnly.reasonCode, 'insufficient_visual_coverage');

  const duplicateAssociations = buildSocialProductionPlan({
    baseline: associationBaseline,
    assets: [associatedAssets[0]!, { ...associatedAssets[1]!, contentHash: associatedAssets[0]!.contentHash }],
  });
  assert.equal(duplicateAssociations.ok, false, 'duplicate bytes are one material, not two independent uploads');

  const inspirationBaseline = freezeSocialScriptBaseline({
    brief: {
      title: forbiddenUserText, objective: forbiddenUserText, productRef: null, audience: null,
      markets: ['中国'], languages: ['中文'], platforms: ['抖音'], formats: ['短视频'], aspectRatio: '9:16',
      cadence: null, requestedOutputCount: 1, dueAt: null, brandNotes: null, restrictions: [], callToAction: null,
    },
    theme: { themeId: 'product_value', inputKind: 'custom', topic: forbiddenUserText, classificationStatus: 'confirmed' },
    inspiration,
    verifiedContext: { productName: '知识库产品', facts: [], source: 'enterprise_product', confidence: 1 },
    lockedAt,
  });
  assert.equal(inspirationBaseline.source, 'inspiration_script');
  assert.equal(inspirationBaseline.match?.inspirationReference?.recordId, 'inspiration-1');
  assert.deepEqual(inspirationBaseline.scenes[0]?.referenceStructure, inspiration?.nodes[0]?.referenceStructure,
    'the task baseline retains safe per-shot timing and camera grammar from exact reference analysis');

  const sourcePath = path.join(temporaryRoot, 'single-upload.mp4');
  const generated = await runVisualFfmpeg([
    '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=25:duration=12',
    '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', sourcePath,
  ]);
  assert.equal(generated.ok, true, generated.stderr || 'failed to create the single source video');
  assert.equal(fs.existsSync(sourcePath), true);

  const locallyDetectedSegments = await detectDistinctTaskVideoSegments({
    id: 'task-upload-with-multiple-shots', name: '用户上传完整视频', type: 'video',
    sourceId: 'task-source', url: sourcePath, localPath: sourcePath, duration: 12,
    contentHash: 'task-upload-content', visualObservations: [], segments: [], selectionOrigin: 'task',
  });
  assert.ok(locallyDetectedSegments.length >= 2,
    'one complete task video with visibly distinct frames must yield multiple local edit windows');
  const localFallbackPlan = buildSocialProductionPlan({
    baseline: systemBaseline,
    assets: [{
      id: 'task-upload-with-multiple-shots', name: '用户上传完整视频', type: 'video',
      sourceId: 'task-source', url: sourcePath, localPath: sourcePath, duration: 12,
      contentHash: 'task-upload-content', visualObservations: [], segments: locallyDetectedSegments,
      selectionOrigin: 'task',
    }],
  });
  assert.equal(localFallbackPlan.ok, true, localFallbackPlan.message);
  assert.equal(localFallbackPlan.selectedAssetIds.length, 1);
  assert.equal(localFallbackPlan.selectedAssetIds[0], 'task-upload-with-multiple-shots');
  assert.ok(localFallbackPlan.scenes.length >= 2);
  assert.equal(localFallbackPlan.scenes.every(scene => scene.clip.confidence === 0
    && scene.clip.needsReview
    && scene.clip.evidenceBasis === 'user_product_association'), true,
  'local visual difference is usable for editing but must not manufacture semantic confidence');
  const localKnowledgePlan = buildSocialProductionPlan({
    baseline: fallbackBaseline,
    assets: [{
      id: 'knowledge-backed-task-upload', name: '有知识脚本的任务上传视频', type: 'video',
      sourceId: 'knowledge-task-source', url: sourcePath, localPath: sourcePath, duration: 12,
      contentHash: 'knowledge-task-content', visualObservations: [], segments: locallyDetectedSegments,
      selectionOrigin: 'task',
    }],
  });
  assert.equal(localKnowledgePlan.ok, true, localKnowledgePlan.message);
  assert.deepEqual(localKnowledgePlan.selectedAssetIds, ['knowledge-backed-task-upload'],
    'a safe knowledge baseline must still edit the directly uploaded multi-shot video');

  const asset = {
    id: 'uploaded-video-1', name: '用户上传的唯一视频', type: 'video' as const,
    sourceId: 'source-1', url: sourcePath, localPath: sourcePath, duration: 12,
    contentHash: 'content-hash-1',
    visualObservations: ['产品瓶身与包装在画面中清晰可见'],
    segments: Array.from({ length: 4 }, (_, index) => ({
      id: `segment-${index + 1}`, start: index * 3, end: (index + 1) * 3,
      confidence: 0.9, needsReview: false,
      observedFacts: index === 0 ? '产品全貌'
        : index === 1 ? '关键结构或原料'
          : index === 2 ? '产品与使用对象真实演示'
            : '检测参数或对比证据',
    })),
  };
  const plan = buildSocialProductionPlan({ baseline, assets: [asset] });
  assert.equal(plan.ok, true, plan.message);
  assert.equal(plan.scenes.length, 4);
  assert.equal(new Set(plan.scenes.map(scene => `${scene.clip.start}-${scene.clip.end}`)).size, 4,
    'one upload may provide several non-overlapping real clips, never one looped interval');
  const reviewDirective = socialReviewRevisionDirective('请缩短口播和字幕，开头更直接；配乐更沉稳');
  assert.deepEqual(reviewDirective.categories, ['shorter', 'opening', 'captions', 'music']);
  assert.equal(reviewDirective.musicMood, '稳重、可信、商务');
  const tooShortDirective = socialReviewRevisionDirective('成片太短，约14.65秒才符合要求；字幕含内部占位语，请重写');
  assert.equal(tooShortDirective.categories.includes('shorter'), false);
  assert.equal(tooShortDirective.narrationRatio, 1, 'mentioning subtitles must not shorten a video reported as too short');
  const revisedPlan = applySocialReviewRevision(plan, reviewDirective);
  assert.ok(revisedPlan.scenes.every((scene, index) => (
    [...scene.narration].length <= [...plan.scenes[index]!.narration].length
  )), 'review feedback is converted to bounded director controls instead of becoming script text');
  assert.doesNotMatch(revisedPlan.scenes.map(scene => scene.narration).join(''), /请缩短口播/);
  const revisedAssociationPlan = applySocialReviewRevision(
    associationPlan,
    socialReviewRevisionDirective('字幕再精简一点，但每句话必须完整自然'),
  );
  assert.equal(revisedAssociationPlan.scenes.every(scene => /[。！？]$/.test(scene.narration)), true);
  assert.doesNotMatch(revisedAssociationPlan.scenes.map(scene => scene.narration).join(''), /的已。|用户明确关联到本次。/,
    'review revision must preserve complete Chinese phrases');

  const selection = buildSocialProductionPlan({
    baseline,
    assets: [asset, {
      id: 'unrelated-image', name: '无关办公室图片', type: 'image' as const, sourceId: 'source-2',
      url: 'data:image/png;base64,AA==', duration: 0, visualObservations: ['空办公室与天空'], segments: [],
    }, {
      ...asset, id: 'duplicate-upload', sourceId: 'source-3', name: '重复上传视频',
    }],
  });
  assert.equal(selection.ok, true);
  assert.deepEqual(selection.selectedAssetIds, ['uploaded-video-1']);
  assert.equal(selection.unusedAssets.some(item => item.assetId === 'unrelated-image' && /不相关/.test(item.reason)), true);
  assert.equal(selection.unusedAssets.some(item => item.assetId === 'duplicate-upload' && /重复/.test(item.reason)), true);

  const insufficient = buildSocialProductionPlan({
    baseline,
    assets: [{
      ...asset, id: 'too-short', sourceId: 'source-short', duration: 4,
      segments: [{ id: 'only-segment', start: 0, end: 4, confidence: 0.9, needsReview: false, observedFacts: '产品全貌' }],
    }],
  });
  assert.equal(insufficient.ok, false);
  assert.equal(insufficient.reasonCode, 'insufficient_visual_coverage');

  const directorPlan = buildSocialDirectorPlan({
    taskId: 'social-auto-render-test-task',
    baseline,
    productionPlan: plan,
    productionAssets: [asset],
    sourceVersions: { 'source-1': 'source-version-1' },
    outputSpec: { aspectRatio: '9:16', resolution: '720p', platform: 'douyin' },
    bgmSelection: {
      primary: {
        trackId: 'test-authorized-bgm', name: '测试授权配乐', mood: '专业',
        authorization: {
          status: 'authorized', basis: 'tenant_uploaded_warranty',
          license: '企业上传时确认拥有使用权', evidence: 'test-catalog:test-authorized-bgm',
        },
      },
      fallbacks: [], fallbackPolicy: 'ordered_preapproved_tracks_only', volume: 0,
    },
    formula,
    createdAt: lockedAt,
  });
  const contentHandoff = socialDirectorContentHandoff(directorPlan);
  assert.equal(contentHandoff.outputSpec.aspectRatio, '9:16');
  assert.equal(contentHandoff.scenes.every(scene => scene.source.renderUrl === sourcePath), true);

  if (process.platform !== 'darwin') {
    console.log('Social auto-production render smoke skipped: local test TTS requires macOS /usr/bin/say');
  } else {
    const narration = contentHandoff.narration;
    const voice = await synthesizeStudioVoiceForAutomation({
      tenantId: 'social-auto-render-test', text: narration, language: 'zh', voice: 'v1',
      style: { preset: 'professional_b2b', speed: 1.12, pauseStyle: 'natural' },
    });
    assert.equal(voice.ok, true, voice.error);
    assert.equal(voice.source, 'local_say');
    assert.ok(voice.localPath && fs.existsSync(voice.localPath));
    assert.ok(voice.cues?.length);

    const duration = Math.max(1, Number(voice.duration || voice.cues!.at(-1)?.end || 1));
    assert.ok(duration <= plan.maxDuration + 0.25, `voice ${duration}s must fit visual budget ${plan.maxDuration}s`);
    const timeline = socialDirectorRenderTimeline(contentHandoff, duration);
    assert.equal(timeline.length, plan.scenes.length);
    assert.ok(timeline.every(scene => scene.type === 'video' && Number(scene.trimEnd) > Number(scene.trimStart)));

    const outputDir = path.join(temporaryRoot, 'renders');
    const rendered = await composite({
      jobId: 'single-material-auto-production',
      requireVisualAssets: true,
      spec: {
        ratio: contentHandoff.outputSpec.aspectRatio,
        resolution: contentHandoff.outputSpec.resolution,
        duration,
        platform: contentHandoff.outputSpec.platform,
        language: contentHandoff.outputSpec.language,
        bgmVol: 0,
        voiceVol: contentHandoff.outputSpec.voiceVolume,
      },
      timeline,
      voiceover: { url: voice.localPath },
      bgm: { id: null, url: null },
      subtitles: {
        mode: 'target', cues: socialDirectorSceneTimingCues(contentHandoff, duration),
        style: {
          fontScale: contentHandoff.direction.subtitles.fontScale,
          bottomRatio: contentHandoff.direction.subtitles.bottomRatio,
        },
      },
    }, undefined, outputDir);
    assert.equal(rendered.ok, true, rendered.error);
    assert.ok(rendered.outputPath && fs.existsSync(rendered.outputPath));
    assert.ok(fs.statSync(rendered.outputPath!).size > 10_000, 'rendered MP4 must contain real media bytes');
    const quality = await inspectRenderedVisuals({ outputPath: rendered.outputPath!, expectedDuration: duration, expectedUniqueScenes: plan.scenes.length });
    assert.equal(quality.passed, true, quality.failures.join('; '));
    const sceneQuality = await inspectRenderedScenes({
      outputPath: rendered.outputPath!, scenes: socialDirectorSceneTimingCues(contentHandoff, duration), requireDistinct: true,
    });
    assert.equal(sceneQuality.passed, true, sceneQuality.issues.map(issue => issue.reason).join('; '));
    const audio = await runVisualFfmpeg(['-i', rendered.outputPath!, '-map', '0:a:0', '-t', '1', '-f', 'null', '-']);
    assert.equal(audio.ok, true, audio.stderr || 'rendered MP4 audio could not be decoded');
    console.log(`Social auto-production single-material MP4 render passed (${path.basename(rendered.outputPath!)})`);
  }
} finally {
  process.chdir(previous.cwd);
  process.env.NODE_ENV = previous.NODE_ENV;
  if (previous.DASHSCOPE_API_KEY === undefined) delete process.env.DASHSCOPE_API_KEY;
  else process.env.DASHSCOPE_API_KEY = previous.DASHSCOPE_API_KEY;
  if (previous.MINIMAX_API_KEY === undefined) delete process.env.MINIMAX_API_KEY;
  else process.env.MINIMAX_API_KEY = previous.MINIMAX_API_KEY;
  if (previous.MINIMAX_API_TOKEN === undefined) delete process.env.MINIMAX_API_TOKEN;
  else process.env.MINIMAX_API_TOKEN = previous.MINIMAX_API_TOKEN;
}

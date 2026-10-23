import { type Material } from '../routes/studioMaterialProjection.js';
import { productIdentity } from '../digitalEmployees/contentProductionPlanning.js';
import { readMaterialLibrary } from '../lib/materialLibrary.js';
import { createHash } from 'node:crypto';
import { isTenantPrivateObjectKey } from '../storage/materialAssets.js';
import { readTenantEnterpriseProfile } from '../routes/enterprise.js';
import { type ReferenceImage } from '../lib/imageGen.js';
import { type StoryboardShotSpec } from '../../shared/storyboardShotSpec.js';
import { storyboardAigcProjectBudget } from '../lib/storyboardAigcProjectBudget.js';
import { automaticManagedFallbackFrameAdmission } from '../lib/storyboardAigcQuality.js';
import { CONTROLLED_PRODUCT_FRAME_SOURCE } from '../lib/controlledProductImageAnimation.js';
import { readTenantMaterialBytes } from '../lib/sentenceReplicationProduction.js';
import { type StudioAigcBudgetContext } from '../routes/studioAigcBatchBudget.js';
import { validateReplicationVideo } from '../lib/automatedReplicationBridge.js';
import { storyboardProjectShotInput } from '../lib/storyboardProjectShotInput.js';
import { storyboardAigcAssignmentIssues, storyboardAigcCurrentKbIssues } from '../lib/storyboardAigcAssignment.js';
import { verifiedStudioGenerationFromSpec } from '../lib/studioGenerationVerification.js';
import { confirmationFields } from '../lib/studioGenerationTruthfulness.js';
import { appendMaterialUsageManifest, buildStudioMaterialUsageManifest } from '../lib/materialUsageTracking.js';

import type { StudioApplicationPorts } from './applicationPorts.js';

export function createProjectEvidenceApplication(deps: Pick<StudioApplicationPorts, 'loadMaterials' | 'storyboardReplayFrameBytesCurrent' | 'storyboardUrlImage' | 'storyboardEnterpriseImage' | 'storyboardCharacterMaterialAuthorizationIssue' | 'storyboardPersonAssetImage' | 'storyboardMaterialImage'>) {
  const loadMaterials: StudioApplicationPorts['loadMaterials'] = (...args) => deps.loadMaterials(...args);
  const storyboardReplayFrameBytesCurrent: StudioApplicationPorts['storyboardReplayFrameBytesCurrent'] = (...args) => deps.storyboardReplayFrameBytesCurrent(...args);
  const storyboardUrlImage: StudioApplicationPorts['storyboardUrlImage'] = (...args) => deps.storyboardUrlImage(...args);
  const storyboardEnterpriseImage: StudioApplicationPorts['storyboardEnterpriseImage'] = (...args) => deps.storyboardEnterpriseImage(...args);
  const storyboardCharacterMaterialAuthorizationIssue: StudioApplicationPorts['storyboardCharacterMaterialAuthorizationIssue'] = (...args) => deps.storyboardCharacterMaterialAuthorizationIssue(...args);
  const storyboardPersonAssetImage: StudioApplicationPorts['storyboardPersonAssetImage'] = (...args) => deps.storyboardPersonAssetImage(...args);
  const storyboardMaterialImage: StudioApplicationPorts['storyboardMaterialImage'] = (...args) => deps.storyboardMaterialImage(...args);

  function unpublishableGenerationReasons(spec: Record<string, unknown>): string[] {
    const reasons: string[] = [];
    const inspect = (label: string, value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      const item = value as Record<string, unknown>;
      const source = String(item.provenance || item.source || item.generationProvenance || item.generationSource || '').toLowerCase();
      const quality = String(item.qualityStatus || '').toLowerCase();
      const hasGeneratedContent = Boolean(
        String(item.script || item.caption || '').trim()
        || (item.poster && typeof item.poster === 'object')
        || (Array.isArray(item.items) && item.items.length),
      );
      if (hasGeneratedContent && !source) reasons.push(`${label}缺少明确生成来源，仅可保存为草稿`);
      if (hasGeneratedContent && !quality) reasons.push(`${label}缺少质量校验结论，仅可保存为草稿`);
      if (hasGeneratedContent && item.publishable !== true) reasons.push(`${label}没有明确可发布结论`);
      if (['template', 'local', 'fallback', 'manual_draft', 'ai_failed', 'ai_rejected'].includes(source)) {
        reasons.push(`${label}来源为${source}，仅可保存为草稿`);
      }
      if (['failed', 'rejected', 'fallback', 'unreviewed', 'needs_confirmation'].includes(quality)) {
        reasons.push(`${label}质量状态为${quality}，尚不可进入交付`);
      }
      if (item.publishable === false) reasons.push(`${label}明确标记为不可发布`);
      const pending = confirmationFields(item.fieldsToConfirm);
      if (pending.length) reasons.push(`${label}仍有待确认商业字段：${pending.join('、')}`);
    };
    if (spec.contentMode === 'poster') {
      inspect('海报草稿', spec.posterDraft);
      inspect('获客内容包', spec.leadContentPackage);
      if (String(spec.posterJsonText || '').trim() && (!spec.posterDraft || typeof spec.posterDraft !== 'object')) {
        reasons.push('海报正文缺少生成来源和质量校验记录，仅可保存为草稿');
      }
    } else if (Array.isArray(spec.modeScripts)) {
      spec.modeScripts.forEach((item, index) => inspect(`脚本${index + 1}`, item));
    }
    if (spec.contentMode !== 'poster' && String(spec.script || '').trim()) {
      const currentScript = String(spec.script).trim();
      const hasVerifiedRecord = Array.isArray(spec.modeScripts) && spec.modeScripts.some(value => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        const item = value as Record<string, unknown>;
        const source = String(item.generationProvenance || item.generationSource || item.provenance || item.source || '').toLowerCase();
        const quality = String(item.qualityStatus || '').toLowerCase();
        return String(item.script || '').trim() === currentScript
          && source === 'ai'
          && Boolean(quality)
          && !['failed', 'rejected', 'fallback', 'unreviewed', 'needs_confirmation'].includes(quality)
          && item.publishable === true;
      });
      if (!hasVerifiedRecord) reasons.push('当前脚本缺少与正文一致的 AI 来源、质量和可发布记录');
    }
    return Array.from(new Set(reasons));
  }

  async function automationStoryboardAssignmentIssues(tenantId: string, projectId: string, spec: Record<string, unknown>, materials = loadMaterials()): Promise<string[]> {
    return [...storyboardAigcAssignmentIssues({ tenantId, projectId, spec, materials }), ...await storyboardKbAssignmentIssuesForSpec(tenantId, spec, materials)];
  }

  async function studioAigcBudgetContext(tenantId: string, project: { id: string; tenant_id: string; spec?: Record<string, any> }): Promise<StudioAigcBudgetContext> {
    if (!tenantId || project.tenant_id !== tenantId) throw new Error('制作预算项目不属于当前企业');
    const spec = project.spec || {};
    const materials = loadMaterials().filter(item => item.tenantId === tenantId);
    const verifiedContentSha256ByMaterialId: Record<string, string> = {};
    const verifiedFirstFrameContentSha256ByMaterialId: Record<string, string> = {};
    for (const [slotId, materialId] of Object.entries(spec.storyboardAssignments || {})) {
      const material = materials.find(item => item.id === materialId);
      if (!material || material.provenance?.storyboardAigc !== true) continue;
      try {
        const isolated = { ...spec, storyboardAssignments: { [slotId]: materialId }, storyboardAssemblies: [] };
        if ((await automationStoryboardAssignmentIssues(tenantId, project.id, isolated, materials)).length) continue;
        const firstFrame = materials.find(item => item.id === material.provenance?.firstFrameMaterialId);
        if (!firstFrame || !await storyboardReplayFrameBytesCurrent(firstFrame, tenantId, spec)) continue;
        verifiedContentSha256ByMaterialId[material.id] = await validateReplicationVideo(material as any, tenantId);
      } catch { /* Preserve the old asset, but do not quote it as reusable. */ }
    }
    const frameStates: Array<Record<string, any>> = [
      ...Object.entries(spec.automatedReplicationProgress || {}).map(([shotId, state]) => ({ ...(state as Record<string, any>),
        slotId: storyboardProjectShotInput(spec, shotId)?.input.slotId || shotId })),
      ...Object.entries(spec.storyboardSourcePlans || {}).map(([slotId, plan]) => ({ ...(plan as Record<string, any>),
        slotId: storyboardProjectShotInput(spec, slotId)?.input.slotId || slotId })),
    ];
    for (const state of frameStates) {
      const frame = materials.find(item => item.id === state.firstFrameMaterialId);
      const p = frame?.provenance as Record<string, any> | undefined;
      const sourcePlan = spec.storyboardSourcePlans?.[state.slotId];
      const managedFallbackAccepted = automaticManagedFallbackFrameAdmission(p, sourcePlan);
      const controlledProductFrame = frame?.sourceType === CONTROLLED_PRODUCT_FRAME_SOURCE;
      if (!frame || frame.type !== 'image' || frame.scope !== 'own'
        || frame.sourceType !== 'ai-storyboard-first-frame' && !controlledProductFrame
        || p?.projectId !== project.id || p.shotId !== state.slotId
        || (p.firstFrameQuality?.passed !== true && !managedFallbackAccepted)
        || state.firstFrameFingerprint && p.fingerprint !== state.firstFrameFingerprint || !p?.firstFrameQualityInput?.sourceSha256) continue;
      try {
        const current = storyboardProjectShotInput(spec, String(p.shotId || ''));
        const shotSpec = p.shotSpec as StoryboardShotSpec | undefined;
        if (!current || current.fingerprint !== p.projectShotFingerprint || !shotSpec
          || shotSpec.shotId !== p.shotId || frame.objectKey && !isTenantPrivateObjectKey(frame.objectKey, tenantId)) continue;
        if ((await storyboardKbFrameVersionIssues(tenantId, shotSpec)).length
          || (await storyboardPersonFrameVersionIssues(tenantId, shotSpec)).length
          || (await storyboardEnvironmentFrameVersionIssues(tenantId, spec, shotSpec)).length) continue;
        const referenceAssets = shotSpec.assets.filter(asset => asset.source === 'reference_video' && asset.role === 'composition');
        let sourceChanged = false;
        for (const asset of referenceAssets) {
          const sourceUrl = String(current.input.reference?.firstFrameRef || '');
          const reference = await storyboardUrlImage(sourceUrl, tenantId);
          if (asset.id !== sourceUrl || !reference || createHash('sha256').update(reference.base64).digest('hex') !== asset.version) sourceChanged = true;
        }
        if (sourceChanged) continue;
        const source = await readTenantMaterialBytes(frame as any, tenantId);
        const hash = createHash('sha256').update(source.bytes).digest('hex');
        if (hash !== p.firstFrameQualityInput.sourceSha256 || (frame as any).contentSha256 && hash !== (frame as any).contentSha256) continue;
        verifiedFirstFrameContentSha256ByMaterialId[frame.id] = hash;
      } catch { /* Missing or changed bytes must remain a visible recovery gap. */ }
    }
    const ledger = await storyboardAigcProjectBudget.status(tenantId, project.id);
    return { tenantId, projectId: project.id, materials, verifiedContentSha256ByMaterialId,
      verifiedFirstFrameContentSha256ByMaterialId, usedCny: ledger.usedCny };
  }

  async function storyboardKbAssignmentIssuesForSpec(tenantId: string, spec: Record<string, unknown>, materials: Material[]) {
    let profilePromise: ReturnType<typeof readTenantEnterpriseProfile> | null = null;
    const productIssues = await storyboardAigcCurrentKbIssues({ spec, materials, readCurrentProductImage: async productId => {
        profilePromise ||= readTenantEnterpriseProfile(tenantId);
        const profile = await profilePromise;
        const products = profile.products.items || [];
        let product = products.find((item, index) => productIdentity(item, index) === productId);
        if (!product) {
          const legacy = productId.match(/^product-(\d+)-(.+)$/);
          const candidate = legacy ? products[Number(legacy[1])] : undefined;
          if (candidate && candidate.name === legacy?.[2] && products.filter(item => item.name === candidate.name).length === 1) product = candidate;
        }
        const imageUrl = String(product?.images?.[0]?.url || product?.imageUrl || '');
        const image = imageUrl ? await storyboardEnterpriseImage(imageUrl, tenantId) : null;
        return image?.base64 || null;
      } });
    const byId = new Map(materials.map(item => [item.id, item]));
    const assignments = [spec.storyboardAssignments,
    ...(Array.isArray(spec.storyboardAssemblies) ? spec.storyboardAssemblies.map((item: any) => item?.assignments) : [])];
    const personAssets = new Map<string, StoryboardShotSpec['assets'][number]>();
    const environmentAssets = new Map<string, StoryboardShotSpec['assets'][number]>();
    const viewSpecs: StoryboardShotSpec[] = [];
    for (const set of assignments) {
      if (!set || typeof set !== 'object' || Array.isArray(set)) continue;
      for (const rawId of Object.values(set)) {
        const video = byId.get(String(rawId || ''));
        if (video?.provenance?.storyboardAigc !== true) continue;
        const frame = byId.get(String(video.provenance.firstFrameMaterialId || ''));
        const shotSpec = frame?.provenance?.shotSpec as StoryboardShotSpec | undefined;
        if (shotSpec?.assets.some(asset => asset.role === 'product_view')) viewSpecs.push(shotSpec);
        for (const asset of shotSpec?.assets || []) {
          if (asset.role === 'person' && asset.source === 'enterprise_asset') personAssets.set(`${asset.id}:${asset.version}`, asset);
          if (asset.role === 'environment' && asset.source === 'enterprise_asset') environmentAssets.set(`${asset.id}:${asset.version}`, asset);
        }
      }
    }
    const personIssues = (await Promise.all([...personAssets.values()].map(asset => storyboardPersonFrameVersionIssues(tenantId,
      { assets: [asset] })))).flat();
    const environmentIssues = (await Promise.all([...environmentAssets.values()].map(asset => storyboardEnvironmentFrameVersionIssues(tenantId,
      spec, { assets: [asset] })))).flat();
    const viewIssues = (await Promise.all(viewSpecs.map(shotSpec => storyboardKbFrameVersionIssues(tenantId,
      { ...shotSpec, assets: shotSpec.assets.filter(asset => asset.role === 'product_view') })))).flat();
    return [...new Set([...productIssues, ...viewIssues, ...personIssues, ...environmentIssues])].sort();
  }

  async function storyboardKbFrameVersionIssues(tenantId: string, shotSpec: StoryboardShotSpec | undefined): Promise<string[]> {
    const assets = (shotSpec?.assets || []).filter(asset => (asset.role === 'product' || asset.role === 'product_view') && asset.source === 'knowledge_base');
    if (!assets.length) return [];
    let profile: Awaited<ReturnType<typeof readTenantEnterpriseProfile>>;
    try { profile = await readTenantEnterpriseProfile(tenantId); }
    catch { return ['企业知识库产品资料暂不可读取']; }
    const products = profile.products.items || [];
    const issues: string[] = [];
    for (const asset of assets) {
      const productId = asset.role === 'product_view' ? String(asset.derivedFromAssetId || '') : asset.id;
      let product = products.find((item, index) => productIdentity(item, index) === productId);
      if (!product) {
        const legacy = productId.match(/^product-(\d+)-(.+)$/);
        const candidate = legacy ? products[Number(legacy[1])] : undefined;
        if (candidate && candidate.name === legacy?.[2] && products.filter(item => item.name === candidate.name).length === 1) product = candidate;
      }
      const viewIndex = asset.role === 'product_view' ? Number(asset.view) : 0;
      const imageUrl = Number.isInteger(viewIndex) && viewIndex >= 0 && viewIndex <= 2
        ? String(product?.images?.[viewIndex]?.url || (viewIndex === 0 ? product?.imageUrl : '') || '') : '';
      let image: Awaited<ReturnType<typeof storyboardEnterpriseImage>> = null;
      try { image = imageUrl ? await storyboardEnterpriseImage(imageUrl, tenantId) : null; }
      catch { /* unreadable current image is a stale input, never a pass */ }
      if (!image || createHash('sha256').update(image.base64).digest('hex') !== asset.version)
        issues.push(`企业知识库产品 ${productId} 的第 ${viewIndex + 1} 张参考图已变化或无法读取`);
    }
    return issues;
  }

  async function storyboardKbProductViewReferences(tenantId: string, shotSpec: StoryboardShotSpec | undefined): Promise<Array<ReferenceImage & { timeLabel: string }>> {
    const assets = (shotSpec?.assets || []).filter(asset => asset.role === 'product_view' && asset.source === 'knowledge_base');
    if (!assets.length) return [];
    const profile = await readTenantEnterpriseProfile(tenantId);
    const products = profile.products.items || [];
    const references: Array<ReferenceImage & { timeLabel: string }> = [];
    for (const asset of assets) {
      const productId = String(asset.derivedFromAssetId || '');
      let product = products.find((item, index) => productIdentity(item, index) === productId);
      if (!product) {
        const legacy = productId.match(/^product-(\d+)-(.+)$/);
        const candidate = legacy ? products[Number(legacy[1])] : undefined;
        if (candidate && candidate.name === legacy?.[2] && products.filter(item => item.name === candidate.name).length === 1) product = candidate;
      }
      const index = Number(asset.view);
      const url = Number.isInteger(index) && index > 0 && index <= 2 ? String(product?.images?.[index]?.url || '') : '';
      const image = url ? await storyboardEnterpriseImage(url, tenantId) : null;
      if (image && createHash('sha256').update(image.base64).digest('hex') === asset.version)
        references.push({ ...image, timeLabel: `企业产品 ${productId} 视角${index + 1}` });
    }
    return references;
  }

  async function storyboardPersonFrameVersionIssues(tenantId: string, shotSpec: Pick<StoryboardShotSpec, 'assets'> | undefined): Promise<string[]> {
    const people = (shotSpec?.assets || []).filter(asset => asset.role === 'person' && asset.source === 'enterprise_asset');
    const issues: string[] = [];
    for (const asset of people) {
      if (!/^https?:\/\//i.test(asset.id) && !asset.id.startsWith('/')) {
        const authIssue = await storyboardCharacterMaterialAuthorizationIssue(tenantId, asset.id);
        if (authIssue) { issues.push(`指定企业人物 ${asset.id} 的使用授权已变化：${authIssue}`); continue; }
      }
      let current: Awaited<ReturnType<typeof storyboardUrlImage>> = null;
      try { current = await storyboardPersonAssetImage(asset.id, tenantId); }
      catch { /* missing or inaccessible identity asset must invalidate the frame */ }
      if (!current || createHash('sha256').update(current.base64).digest('hex') !== asset.version)
        issues.push(`指定企业人物 ${asset.id} 的参考图已变化或无法读取`);
    }
    return issues;
  }

  async function storyboardEnvironmentFrameVersionIssues(tenantId: string, projectSpec: Record<string, any>, shotSpec: Pick<StoryboardShotSpec, 'assets'> | undefined): Promise<string[]> {
    const selected = new Set(Array.isArray(projectSpec.selected) ? projectSpec.selected.map(String) : []);
    const environments = (shotSpec?.assets || []).filter(asset => asset.role === 'environment' && asset.source === 'enterprise_asset');
    const issues: string[] = [];
    for (const asset of environments) {
      const material = loadMaterials().find(item => item.id === asset.id && item.tenantId === tenantId
        && item.scope === 'own' && item.type === 'image'
        && (!item.objectKey || isTenantPrivateObjectKey(item.objectKey, tenantId)));
      let current: ReferenceImage | null = null;
      try { current = material && selected.has(asset.id) ? await storyboardMaterialImage(asset.id, tenantId) : null; }
      catch { /* inaccessible material invalidates the confirmed frame */ }
      if (!current || createHash('sha256').update(current.base64).digest('hex') !== asset.version)
        issues.push(`环境参考图 ${asset.id} 已变化、未选中或无法读取`);
    }
    return issues;
  }

  async function appendCompletedPosterMaterialUsage(input: {
    tenantId: string;
    projectId: string;
    projectTitle: string;
    spec: Record<string, any>;
    usedAt: string;
  }): Promise<Record<string, any>> {
    if (String(input.spec.contentMode || '') !== 'poster') return input.spec;
    const outputMaterialId = String(input.spec.posterImageMaterialId || '').trim();
    if (!outputMaterialId) return input.spec;
    const verification = verifiedStudioGenerationFromSpec(input.spec, {
      generationKind: 'poster',
      generationProvenance: 'ai',
      qualityStatus: 'passed',
      publishable: true,
      generationRecordId: 'poster-current',
    });
    if (!verification.ok) return input.spec;
    const inventory = await readMaterialLibrary(input.tenantId);
    const output = inventory.items.find(item => item.id === outputMaterialId && item.type === 'image');
    if (!output) return input.spec;
    return appendMaterialUsageManifest(input.spec, buildStudioMaterialUsageManifest({
      projectId: input.projectId,
      projectTitle: input.projectTitle,
      artifactId: `poster:${outputMaterialId}`,
      usedAt: output.createdAt || input.usedAt,
      spec: input.spec,
    }));
  }

  return { unpublishableGenerationReasons, automationStoryboardAssignmentIssues, studioAigcBudgetContext, storyboardKbAssignmentIssuesForSpec, storyboardKbFrameVersionIssues, storyboardKbProductViewReferences, storyboardPersonFrameVersionIssues, storyboardEnvironmentFrameVersionIssues, appendCompletedPosterMaterialUsage };
}

import { productIdentity } from '../digitalEmployees/contentProductionPlanning.js';
import { createHash } from 'node:crypto';
import { isTenantPrivateObjectKey } from '../storage/materialAssets.js';
import { readTenantEnterpriseProfile } from './enterprise.js';
import { store } from '../storage/index.js';
import { type ReferenceImage } from '../lib/imageGen.js';
import { type StoryboardShotSpec } from '../../shared/storyboardShotSpec.js';
import { applyStoryboardReplicationAutomation, automaticManagedFallbackFrameAdmission, buildStoryboardQaReport, inspectStoryboardTechnicalFrames, reviewStoryboardQaReport, storyboardQaObservationContractIssues, storyboardQaRequiredChecks, type StoryboardQaReport } from '../lib/storyboardAigcQuality.js';
import { readTenantMaterialBytes } from '../lib/sentenceReplicationProduction.js';
import { storyboardProjectShotInput } from '../lib/storyboardProjectShotInput.js';
import { inspectStoryboardAigcFramesWithQwen } from '../agents/qwen.js';
import { type AuthLocals } from '../middleware/auth.js';

import type { StudioApplicationPorts } from '../studio/applicationPorts.js';

export function createStudioStoryboardFrameReviewRoutes(deps: Pick<StudioApplicationPorts, 'studioRouter' | 'loadMaterials' | 'storyboardKbFrameVersionIssues' | 'storyboardPersonFrameVersionIssues' | 'storyboardEnvironmentFrameVersionIssues' | 'storyboardEnterpriseImage' | 'storyboardKbProductViewReferences' | 'storyboardPersonAssetImage' | 'storyboardMaterialImage' | 'persistMaterials'>) {
  const studioRouter = deps.studioRouter;
  const loadMaterials: StudioApplicationPorts['loadMaterials'] = (...args) => deps.loadMaterials(...args);
  const storyboardKbFrameVersionIssues: StudioApplicationPorts['storyboardKbFrameVersionIssues'] = (...args) => deps.storyboardKbFrameVersionIssues(...args);
  const storyboardPersonFrameVersionIssues: StudioApplicationPorts['storyboardPersonFrameVersionIssues'] = (...args) => deps.storyboardPersonFrameVersionIssues(...args);
  const storyboardEnvironmentFrameVersionIssues: StudioApplicationPorts['storyboardEnvironmentFrameVersionIssues'] = (...args) => deps.storyboardEnvironmentFrameVersionIssues(...args);
  const storyboardEnterpriseImage: StudioApplicationPorts['storyboardEnterpriseImage'] = (...args) => deps.storyboardEnterpriseImage(...args);
  const storyboardKbProductViewReferences: StudioApplicationPorts['storyboardKbProductViewReferences'] = (...args) => deps.storyboardKbProductViewReferences(...args);
  const storyboardPersonAssetImage: StudioApplicationPorts['storyboardPersonAssetImage'] = (...args) => deps.storyboardPersonAssetImage(...args);
  const storyboardMaterialImage: StudioApplicationPorts['storyboardMaterialImage'] = (...args) => deps.storyboardMaterialImage(...args);
  const persistMaterials: StudioApplicationPorts['persistMaterials'] = (...args) => deps.persistMaterials(...args);

  function registerPostStoryboardFirstFrameIdRecheckQuality() {
    studioRouter.post('/storyboard-first-frame/:id/recheck-quality', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const list = loadMaterials();
      const material = list.find(item => item.id === req.params.id && item.tenantId === tenantId
        && item.scope === 'own' && item.type === 'image' && item.sourceType === 'ai-storyboard-first-frame');
      if (!material) { res.status(404).json({ ok: false, error: '首帧候选不存在' }); return; }
      const fingerprint = String(req.body?.fingerprint || '');
      const shotId = String(req.body?.shotId || '');
      if (!fingerprint || material.provenance?.fingerprint !== fingerprint || material.provenance?.shotId !== shotId) {
        res.status(409).json({ ok: false, code: 'FIRST_FRAME_INPUT_CHANGED', error: '首帧输入已变化，不能复用原图质检' }); return;
      }
      if (material.objectKey && !isTenantPrivateObjectKey(material.objectKey, tenantId)) {
        res.status(409).json({ ok: false, code: 'FIRST_FRAME_SOURCE_UNTRUSTED', error: '首帧原图不属于当前企业的私有存储空间' }); return;
      }
      const projectId = String(material.provenance?.projectId || '');
      const currentProject = await store.getById<any>('studio_projects', projectId);
      const currentInput = currentProject?.tenant_id === tenantId ? storyboardProjectShotInput(currentProject.spec ?? {}, shotId) : null;
      if (!currentInput || currentInput.fingerprint !== material.provenance?.projectShotFingerprint) {
        res.status(409).json({ ok: false, code: 'STORYBOARD_PROJECT_INPUT_CHANGED', error: '当前分镜输入已变化，不能复用原图质检' }); return;
      }
      const shotSpec = material.provenance?.shotSpec as StoryboardShotSpec | undefined;
      if (!shotSpec || shotSpec.shotId !== shotId) {
        res.status(409).json({ ok: false, code: 'STORYBOARD_PROJECT_INPUT_CHANGED', error: '首帧缺少当前分镜规格，不能复用原图质检' }); return;
      }
      const productIds = Array.isArray(material.provenance?.productIds)
        ? material.provenance.productIds.map(String) : material.productId ? [material.productId] : [];
      const currentProductIds = currentInput.input.source.productIds;
      const shotProductIds = shotSpec.assets.filter(asset => asset.role === 'product' && asset.source === 'knowledge_base').map(asset => asset.id);
      const hasSelectedProductContract = Array.isArray(currentProject.spec?.selectedProductIds);
      const selectedProductIds = hasSelectedProductContract ? currentProject.spec.selectedProductIds.map(String) : [];
      if (JSON.stringify(productIds) !== JSON.stringify(currentProductIds)
        || JSON.stringify(productIds) !== JSON.stringify(shotProductIds)
        || (hasSelectedProductContract && productIds.some(id => !selectedProductIds.includes(id)))
        || (material.productId && material.productId !== productIds[0])) {
        res.status(409).json({ ok: false, code: 'STORYBOARD_PRODUCT_BINDING_CHANGED', error: '首帧绑定的产品与当前分镜不一致，不能复用原图质检' }); return;
      }
      const kbIssues = await storyboardKbFrameVersionIssues(tenantId, shotSpec);
      if (kbIssues.length) { res.status(409).json({ ok: false, code: 'STORYBOARD_PRODUCT_IMAGE_CHANGED', error: kbIssues.join('；') }); return; }
      const personIssues = await storyboardPersonFrameVersionIssues(tenantId, shotSpec);
      if (personIssues.length) { res.status(409).json({ ok: false, code: 'STORYBOARD_PERSON_IMAGE_CHANGED', error: personIssues.join('；') }); return; }
      const environmentIssues = await storyboardEnvironmentFrameVersionIssues(tenantId, currentProject.spec ?? {}, shotSpec);
      if (environmentIssues.length) { res.status(409).json({ ok: false, code: 'STORYBOARD_ENVIRONMENT_IMAGE_CHANGED', error: environmentIssues.join('；') }); return; }

      let source: { bytes: Buffer; mimeType: string };
      try { source = await readTenantMaterialBytes(material as any, tenantId); }
      catch (error) {
        res.status(422).json({ ok: false, code: 'FIRST_FRAME_SOURCE_UNAVAILABLE', error: error instanceof Error ? error.message : '首帧原图不可读取' }); return;
      }
      if (!/^image\/(?:png|jpe?g|webp)$/i.test(source.mimeType)) {
        res.status(422).json({ ok: false, code: 'FIRST_FRAME_SOURCE_UNAVAILABLE', error: '首帧原图格式不可质检' }); return;
      }
      const sourceSha256 = createHash('sha256').update(source.bytes).digest('hex');
      const storedSha256 = String((material as any).contentSha256 || '');
      if (storedSha256 && storedSha256 !== sourceSha256) {
        res.status(409).json({ ok: false, code: 'FIRST_FRAME_SOURCE_CHANGED', error: '首帧原图内容已变化，不能复用原图质检' }); return;
      }

      const productReferences: Array<ReferenceImage & { timeLabel: string }> = [];
      const productNames: string[] = [];
      if (productIds.length) {
        const profile = await readTenantEnterpriseProfile(tenantId);
        const products = profile.products.items || [];
        for (const [index, productId] of productIds.entries()) {
          let product = products.find((item, productIndex) => productIdentity(item, productIndex) === productId);
          if (!product) {
            const legacy = productId.match(/^product-(\d+)-(.+)$/);
            const candidate = legacy ? products[Number(legacy[1])] : undefined;
            if (candidate && candidate.name === legacy?.[2] && products.filter(item => item.name === candidate.name).length === 1) product = candidate;
          }
          const imageUrl = String(product?.images?.[0]?.url || product?.imageUrl || '');
          const image = imageUrl ? await storyboardEnterpriseImage(imageUrl, tenantId) : null;
          if (!product || !image) {
            res.status(422).json({ ok: false, code: 'PRODUCT_REFERENCE_UNAVAILABLE', error: `知识库产品 ${productId} 的参考图不可读取` }); return;
          }
          productNames.push(String(product.name || ''));
          productReferences.push({ ...image, timeLabel: `企业产品参考${index + 1}：${String(product.name || '')}` });
        }
      }
      const viewAssets = shotSpec.assets.filter(asset => asset.role === 'product_view');
      const viewReferences = await storyboardKbProductViewReferences(tenantId, shotSpec);
      if (viewReferences.length !== viewAssets.length) {
        res.status(409).json({ ok: false, code: 'STORYBOARD_PRODUCT_IMAGE_CHANGED', error: '产品多角度参考图已变化或无法读取' }); return;
      }
      productReferences.push(...viewReferences);
      const personAsset = shotSpec.assets.find(asset => asset.role === 'person');
      const personReference = personAsset ? await storyboardPersonAssetImage(personAsset.id, tenantId) : null;
      if (personAsset && !personReference) {
        res.status(422).json({ ok: false, code: 'PERSON_REFERENCE_UNAVAILABLE', error: '指定人物参考图已失效，请补充资产后重新质检' }); return;
      }
      const environmentAsset = shotSpec.assets.find(asset => asset.role === 'environment');
      const environmentReference = environmentAsset ? await storyboardMaterialImage(environmentAsset.id, tenantId) : null;
      if (environmentAsset && !environmentReference) {
        res.status(422).json({ ok: false, code: 'ENVIRONMENT_REFERENCE_UNAVAILABLE', error: '工厂环境参考图已失效，请补充资产后重新质检' }); return;
      }

      const qaShape = {
        phase: 'first_frame' as const, sceneType: shotSpec.scene,
        hasProduct: productIds.length > 0, hasNamedPerson: !!personReference,
        hasEnvironmentReference: !!environmentReference,
        hasContact: shotSpec.constraints.includes('physical_contact'),
        hasAction: !!(shotSpec.action.startState || shotSpec.action.beats.length),
      };
      const frame = { bytes: source.bytes, timeLabel: '候选首帧' };
      const technical = await inspectStoryboardTechnicalFrames('first_frame', [frame]);
      let observations: unknown;
      try {
        observations = await inspectStoryboardAigcFramesWithQwen({
          phase: 'first_frame', sceneType: shotSpec.scene,
          frames: [{ base64: source.bytes.toString('base64'), mimeType: source.mimeType, timeLabel: '候选首帧' }],
          productReferences,
          personReferences: personReference ? [{ ...personReference, timeLabel: '企业人物参考' }] : [],
          environmentReferences: environmentReference && !(shotSpec.mode === 'replication' && !personReference)
            ? [{ ...environmentReference, timeLabel: '企业工厂环境参考' }] : [],
          storyboard: shotSpec.description, productInfo: productNames.join('、'),
          startState: shotSpec.action.startState, beats: shotSpec.action.beats, endState: shotSpec.action.endState,
        });
      } catch (error) {
        console.warn('[studio] first-frame QA recheck service unavailable:', error);
        res.status(503).json({ ok: false, code: 'FIRST_FRAME_QA_SERVICE_UNAVAILABLE',
          error: '首帧视觉质检服务暂不可用，已保留原图和原质检状态，可稍后重试', retryable: true }); return;
      }
      const rawObservations = Array.isArray(observations) ? observations : [];
      const candidateLabels = ['候选首帧'];
      const contractIssues = storyboardQaObservationContractIssues({ observations: rawObservations,
        requiredKeys: storyboardQaRequiredChecks(qaShape), candidateLabels,
        allowedCitationLabels: [...productReferences.map(item => item.timeLabel),
        ...(personReference ? ['企业人物参考'] : []), ...(environmentReference ? ['企业工厂环境参考'] : []), ...candidateLabels],
        technicalKeys: technical.map(item => item.key),
      });
      if (contractIssues.length) {
        res.status(502).json({ ok: false, code: 'FIRST_FRAME_QA_RESPONSE_INVALID',
          error: `首帧质检响应不完整（${contractIssues.join('、')}），已保留原质检状态`, retryable: true }); return;
      }
      let quality = buildStoryboardQaReport({ ...qaShape,
        observations: [...rawObservations.filter(item => !technical.some(check => check.key === (item as any)?.key)), ...technical],
        evidenceFrameLabels: ['候选首帧'],
      });
      const currentSourcePlan = currentProject.spec?.storyboardSourcePlans?.[shotId];
      const managedFallbackAutomation = automaticManagedFallbackFrameAdmission({ ...material.provenance,
        firstFrameQuality: quality, firstFrameQualityState: 'evaluated' }, currentSourcePlan);
      if (shotSpec.mode === 'replication' && !personReference || managedFallbackAutomation) {
        quality = applyStoryboardReplicationAutomation(quality);
      }

      const latest = loadMaterials();
      const current = latest.find(item => item.id === material.id && item.tenantId === tenantId
        && item.sourceType === 'ai-storyboard-first-frame');
      const latestProject = await store.getById<any>('studio_projects', projectId);
      const latestInput = latestProject?.tenant_id === tenantId ? storyboardProjectShotInput(latestProject.spec ?? {}, shotId) : null;
      if (!current || current.objectKey !== material.objectKey || current.file !== material.file
        || current.provenance?.fingerprint !== fingerprint
        || current.provenance?.projectShotFingerprint !== material.provenance?.projectShotFingerprint
        || latestInput?.fingerprint !== material.provenance?.projectShotFingerprint) {
        res.status(409).json({ ok: false, code: 'FIRST_FRAME_SOURCE_CHANGED', error: '质检期间首帧版本已变化，未覆盖质检结果' }); return;
      }
      let currentBytes: { bytes: Buffer; mimeType: string };
      try { currentBytes = await readTenantMaterialBytes(current as any, tenantId); }
      catch { res.status(409).json({ ok: false, code: 'FIRST_FRAME_SOURCE_CHANGED', error: '质检期间首帧原图已不可读取，未覆盖质检结果' }); return; }
      if (createHash('sha256').update(currentBytes.bytes).digest('hex') !== sourceSha256) {
        res.status(409).json({ ok: false, code: 'FIRST_FRAME_SOURCE_CHANGED', error: '质检期间首帧原图内容已变化，未覆盖质检结果' }); return;
      }
      const previousProvenance = current.provenance || {};
      const automaticallyConfirmed = quality.acceptanceSource === 'automatic_policy' && quality.passed;
      current.provenance = { ...previousProvenance, firstFrameQuality: quality,
        firstFrameQualityState: 'evaluated', firstFrameQualityError: null,
        firstFrameQualityInput: { sourceSha256, checkedAt: quality.checkedAt, provider: 'qwen_vl' },
        confirmed: automaticallyConfirmed,
        confirmationSource: automaticallyConfirmed ? 'automatic_policy' : undefined,
        qualityStatus: quality.acceptanceSource === 'automatic_policy'
          ? (!quality.passed ? 'automated_checks_failed' : quality.automatedPassed ? 'automated_checks_passed' : 'automatic_policy_with_uncertainties')
          : quality.status === 'needs_review' ? 'needs_review' : 'automated_checks_failed',
        confirmedAt: automaticallyConfirmed ? new Date().toISOString() : undefined };
      persistMaterials(latest);
      if (quality.findings.some(item => item.severity === 'hard_failure')) {
        res.status(409).json({ ok: false, code: 'FIRST_FRAME_QA_FAILED', error: '首帧真实视觉质检未通过，已保留原图并记录失败项',
          materialId: current.id, fingerprint, firstFrameQuality: quality }); return;
      }
      res.json({ ok: true, materialId: current.id, fingerprint, sourceSha256, firstFrameQuality: quality,
        reusedOriginalImage: true });
    });
  }

  function registerPostStoryboardFirstFrameIdConfirm() {
    studioRouter.post('/storyboard-first-frame/:id/confirm', async (req, res) => {
      const { tenantId, userId } = res.locals as AuthLocals;
      const list = loadMaterials();
      const material = list.find(item => item.id === req.params.id && item.tenantId === tenantId && item.sourceType === 'ai-storyboard-first-frame');
      if (!material) { res.status(404).json({ ok: false, error: '首帧候选不存在' }); return; }
      const fingerprint = String(req.body?.fingerprint || '');
      const shotId = String(req.body?.shotId || '');
      if (!fingerprint || material.provenance?.fingerprint !== fingerprint || material.provenance?.shotId !== shotId) {
        res.status(409).json({ ok: false, error: '首帧输入已变化，请重新生成并确认' }); return;
      }
      if (material.provenance?.firstFrameQualityState && material.provenance.firstFrameQualityState !== 'evaluated') {
        res.status(409).json({ ok: false, code: 'FIRST_FRAME_QA_RECHECK_REQUIRED', error: '已保留首帧，请复检原图；质检未完成前不能确认或生成视频' }); return;
      }
      const currentProject = await store.getById<any>('studio_projects', String(material.provenance?.projectId || ''));
      const currentInput = currentProject?.tenant_id === tenantId ? storyboardProjectShotInput(currentProject.spec ?? {}, shotId) : null;
      if (!currentInput || currentInput.fingerprint !== material.provenance?.projectShotFingerprint) {
        res.status(409).json({ ok: false, code: 'STORYBOARD_PROJECT_INPUT_CHANGED', error: '当前分镜输入已变化，请重新生成首帧' }); return;
      }
      const kbIssues = await storyboardKbFrameVersionIssues(tenantId, material.provenance?.shotSpec as StoryboardShotSpec | undefined);
      if (kbIssues.length) { res.status(409).json({ ok: false, code: 'STORYBOARD_PRODUCT_IMAGE_CHANGED', error: kbIssues.join('；') }); return; }
      const personIssues = await storyboardPersonFrameVersionIssues(tenantId, material.provenance?.shotSpec as StoryboardShotSpec | undefined);
      if (personIssues.length) { res.status(409).json({ ok: false, code: 'STORYBOARD_PERSON_IMAGE_CHANGED', error: personIssues.join('；') }); return; }
      const environmentIssues = await storyboardEnvironmentFrameVersionIssues(tenantId, currentProject.spec ?? {}, material.provenance?.shotSpec as StoryboardShotSpec | undefined);
      if (environmentIssues.length) { res.status(409).json({ ok: false, code: 'STORYBOARD_ENVIRONMENT_IMAGE_CHANGED', error: environmentIssues.join('；') }); return; }
      if (material.provenance?.confirmed === true) {
        res.json({ ok: true, materialId: material.id, fingerprint, firstFrameQuality: material.provenance.firstFrameQuality }); return;
      }
      const firstFrameQuality = material.provenance?.firstFrameQuality as StoryboardQaReport | undefined;
      if (!firstFrameQuality) { res.status(409).json({ ok: false, error: '首帧缺少质检报告，请复检原图，无需重新生成' }); return; }
      let reviewed: StoryboardQaReport;
      try {
        const confirmShotSpec = material.provenance?.shotSpec as StoryboardShotSpec | undefined;
        reviewed = confirmShotSpec?.mode === 'replication' && !confirmShotSpec.constraints.includes('person_identity')
          ? applyStoryboardReplicationAutomation(firstFrameQuality)
          : reviewStoryboardQaReport(firstFrameQuality, { decision: 'accept', reviewedBy: userId });
        if (!reviewed.passed) throw new Error('首帧存在非背景质量硬失败，请重新生成');
      } catch (error) {
        res.status(409).json({ ok: false, code: 'FIRST_FRAME_QA_FAILED', error: error instanceof Error ? error.message : '首帧质检未通过', firstFrameQuality }); return;
      }
      material.provenance = { ...material.provenance, firstFrameQuality: reviewed, confirmed: true, confirmationSource: reviewed.acceptanceSource === 'automatic_policy' ? 'automatic_policy' : 'user', qualityStatus: reviewed.acceptanceSource === 'automatic_policy' ? (reviewed.automatedPassed ? 'automated_checks_passed' : 'automatic_policy_with_uncertainties') : 'manual_confirmed_after_automated_review', confirmedAt: new Date().toISOString() };
      persistMaterials(list);
      res.json({ ok: true, materialId: material.id, fingerprint });
    });
  }

  return { registerPostStoryboardFirstFrameIdRecheckQuality, registerPostStoryboardFirstFrameIdConfirm };
}

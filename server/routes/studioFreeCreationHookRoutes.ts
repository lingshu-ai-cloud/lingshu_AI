import { materialResponse } from './studioMaterialProjection.js';
import { normalizeFreeCreationProjectSpec } from '../../shared/contracts/freeCreationProject.js';
import { productIdentity } from '../digitalEmployees/contentProductionPlanning.js';
import { createHash } from 'node:crypto';
import { callLLM } from '../agents/llm.js';
import { readTenantEnterpriseProfile } from './enterprise.js';
import { store } from '../storage/index.js';
import { consumeDemoQuota } from '../lib/demo.js';
import { type ReferenceImage } from '../lib/imageGen.js';
import { createGeneratedImageMaterial } from '../lib/generatedImageMaterial.js';
import { SeedreamFirstFrameGenerator } from '../lib/seedreamFirstFrameGenerator.js';
import { FirstFrameProviderError, firstFrameInputFingerprint, type FirstFrameReferenceRole } from '../lib/firstFrameGenerator.js';
import { storyboardProductReferenceSheet } from '../lib/storyboardProductReferenceSheet.js';
import { isInternalBudgetExemptTenant } from '../lib/tenantBudgetExemption.js';
import { matchStoryboardProducts } from '../lib/storyboardProductMatch.js';
import { type AuthLocals } from '../middleware/auth.js';

import type { StudioApplicationPorts } from '../studio/applicationPorts.js';

export function createStudioFreeCreationHookRoutes(deps: Pick<StudioApplicationPorts, 'studioRouter' | 'storyboardEnterpriseImage' | 'loadMaterials' | 'persistMaterials'>) {
  const studioRouter = deps.studioRouter;
  const storyboardEnterpriseImage: StudioApplicationPorts['storyboardEnterpriseImage'] = (...args) => deps.storyboardEnterpriseImage(...args);
  const loadMaterials: StudioApplicationPorts['loadMaterials'] = (...args) => deps.loadMaterials(...args);
  const persistMaterials: StudioApplicationPorts['persistMaterials'] = (...args) => deps.persistMaterials(...args);

  function registerPostFreeCreationHookFirstFrame() {
    studioRouter.post('/free-creation-hook/first-frame', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const projectId = String(req.body?.projectId || '').trim();
      const requestId = String(req.body?.requestId || '').trim().slice(0, 180);
      const productIds = [...new Set<string>((Array.isArray(req.body?.productIds) ? req.body.productIds : []).map((value: unknown) => String(value || '').trim()).filter(Boolean))];
      const goal = String(req.body?.goal || '').trim().slice(0, 500);
      const audience = String(req.body?.audience || '').trim().slice(0, 500);
      const visualIntent = String(req.body?.visualIntent || '').trim().slice(0, 2_000);
      const ratio = ['9:16', '16:9', '1:1'].includes(String(req.body?.ratio)) ? req.body.ratio as '9:16' | '16:9' | '1:1' : '9:16';
      if (!projectId || !/^[A-Za-z0-9_:.-]{8,180}$/.test(requestId) || !productIds.length || !goal || !audience) {
        res.status(400).json({ ok: false, code: 'FREE_HOOK_INPUT_REQUIRED', error: 'AI 钩子需要已保存草稿、稳定请求 ID、产品、内容目标和目标受众' }); return;
      }
      const project = await store.getById<any>('studio_projects', projectId);
      if (!project || project.tenant_id !== tenantId) { res.status(404).json({ ok: false, code: 'FREE_HOOK_PROJECT_NOT_FOUND', error: '当前企业的自由创作草稿不存在' }); return; }
      const saved = normalizeFreeCreationProjectSpec(project.spec || {}).freeCreation;
      if (!saved?.manualWorkflow || saved.hookSource !== 'ai' || JSON.stringify(saved.brief?.productIds || []) !== JSON.stringify(productIds)
        || saved.brief?.goal !== goal || saved.brief?.audience !== audience) {
        res.status(409).json({ ok: false, code: 'FREE_HOOK_DRAFT_CHANGED', error: '产品或创作简报已变化，请等待草稿保存后重试' }); return;
      }
      const profile = await readTenantEnterpriseProfile(tenantId);
      const items = profile.products.items || [];
      const references: ReferenceImage[] = [];
      const names: string[] = [];
      for (const id of productIds) {
        let product = items.find((item, index) => productIdentity(item, index) === id);
        if (!product) {
          const legacy = id.match(/^product-(\d+)-(.+)$/); const candidate = legacy ? items[Number(legacy[1])] : undefined;
          if (candidate && candidate.name === legacy?.[2] && items.filter(item => item.name === candidate.name).length === 1) product = candidate;
        }
        if (!product) { res.status(422).json({ ok: false, code: 'FREE_HOOK_PRODUCT_CHANGED', error: '所选产品已不在当前企业知识库中' }); return; }
        const imageUrl = String(product.images?.[0]?.url || product.imageUrl || '');
        const image = imageUrl ? await storyboardEnterpriseImage(imageUrl, tenantId) : null;
        if (!image) { res.status(422).json({ ok: false, code: 'FREE_HOOK_PRODUCT_IMAGE_REQUIRED', error: `产品「${String(product.name || '')}」缺少可读取的主图` }); return; }
        names.push(String(product.name || '')); references.push(image);
      }
      const reference = references.length === 1 ? references[0]! : await storyboardProductReferenceSheet(references);
      const prompt = [
        `Create the opening frame of a ${ratio} short-form commercial video for these exact products: ${names.join(', ')}.`,
        `Content goal: ${goal}. Target audience: ${audience}.`,
        visualIntent ? `Creative direction: ${visualIntent}.` : 'Create a strong product-first visual hook with a clear focal point and natural commercial lighting.',
        'Preserve the exact visible product identity, packaging shape and colors from the supplied owned reference. Do not invent labels, claims, text, logos, people, before-after results or additional products.',
      ].join('\n');
      const generator = new SeedreamFirstFrameGenerator();
      const frameRequest = { referenceMode: 'storyboard_scene' as const, tenantId, videoId: projectId, compositionId: 'free-creation-hook', presenterVersion: productIds.join(','), prompt, ratio,
        references: [{ role: 'product_identity' as FirstFrameReferenceRole, bytes: Buffer.from(reference.base64, 'base64'), mimeType: reference.mimeType as 'image/jpeg' | 'image/png' | 'image/webp', sha256: createHash('sha256').update(Buffer.from(reference.base64, 'base64')).digest('hex') }], idempotencyKey: requestId };
      const fingerprint = firstFrameInputFingerprint(frameRequest, generator.provider, generator.model);
      const previous = loadMaterials().find(item => item.tenantId === tenantId && item.sourceType === 'ai-free-creation-hook-frame' && item.provenance?.requestId === requestId);
      if (previous) {
        if (previous.provenance?.fingerprint !== fingerprint) { res.status(409).json({ ok: false, code: 'FREE_HOOK_REQUEST_CONFLICT', error: '该请求 ID 已用于不同的 AI 钩子输入' }); return; }
        res.json({ ok: true, reused: true, material: await materialResponse(previous, tenantId), fingerprint, estimatedCostCny: previous.provenance?.estimatedCostCny }); return;
      }
      const configuredBudget = Number(process.env.FREE_CREATION_HOOK_MAX_COST_CNY || 6);
      if (!isInternalBudgetExemptTenant(tenantId) && (!Number.isFinite(configuredBudget) || configuredBudget < generator.estimatedCostCny)) {
        res.status(429).json({ ok: false, code: 'FREE_HOOK_BUDGET_EXCEEDED', error: 'AI 钩子首帧预计费用超过本项目预算，未调用供应商' }); return;
      }
      if (!await consumeDemoQuota(req, res, 'generation')) return;
      try {
        const generated = await generator.generate(frameRequest);
        const material = await createGeneratedImageMaterial({ title: `自由创作 AI 钩子首帧 · ${names.join('、')}`, bytes: generated.bytes, mimeType: generated.mimeType, source: generated.provider, tenantId });
        material.sourceType = 'ai-free-creation-hook-frame';
        material.provenance = { freeCreationHook: true, projectId, requestId, fingerprint, productIds, productNames: names, goal, audience, visualIntent, provider: generated.provider, model: generated.model, providerRequestId: generated.providerRequestId, estimatedCostCny: generated.estimatedCostCny, generatedAt: new Date().toISOString() };
        const list = loadMaterials(); const index = list.findIndex(item => item.id === material.id); if (index >= 0) { list[index] = material; persistMaterials(list); }
        res.json({ ok: true, material: await materialResponse(material, tenantId), fingerprint, estimatedCostCny: generated.estimatedCostCny });
      } catch (error) {
        const status = error instanceof FirstFrameProviderError && error.status === 'rejected' ? 422 : 502;
        res.status(status).json({ ok: false, code: error instanceof FirstFrameProviderError && error.status === 'uncertain' ? 'FREE_HOOK_PROVIDER_UNCERTAIN' : 'FREE_HOOK_FRAME_FAILED', error: error instanceof Error ? error.message : 'AI 钩子首帧生成失败' });
      }
    });
  }

  function registerPostStoryboardProductMatch() {
    studioRouter.post('/storyboard-product-match', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const projectId = String(req.body?.projectId || '').trim();
      const shotId = String(req.body?.shotId || '').trim();
      const project = projectId ? await store.getById<any>('studio_projects', projectId) : null;
      if (!project || project.tenant_id !== tenantId) { res.status(404).json({ ok: false, error: '本片制作项目不存在' }); return; }
      const slot = (Array.isArray(project.spec?.shootingSlots) ? project.spec.shootingSlots : []).find((item: any) => item.slotId === shotId || item.id === shotId);
      if (!slot) { res.status(404).json({ ok: false, error: '当前分镜不在本片项目中' }); return; }
      const selectedIds: string[] = Array.isArray(project.spec?.selectedProductIds) ? project.spec.selectedProductIds.map(String) : [];
      const profile = await readTenantEnterpriseProfile(tenantId);
      const all = profile.products.items || [];
      const products = selectedIds.flatMap(id => {
        let product = all.find((item, index) => productIdentity(item, index) === id);
        if (!product) {
          const legacy = id.match(/^product-(\d+)-(.+)$/);
          const candidate = legacy ? all[Number(legacy[1])] : undefined;
          if (candidate && candidate.name === legacy?.[2] && all.filter(item => item.name === candidate.name).length === 1) product = candidate;
        }
        const details = product as Record<string, unknown> | undefined;
        return product ? [{ id, name: String(product.name || ''), context: String(details?.description || details?.category || '') }] : [];
      });
      if (products.length !== selectedIds.length) { res.status(422).json({ ok: false, error: '本片已选产品与企业知识库不一致，请刷新产品选择' }); return; }
      const description = String(slot.detail || req.body?.shotDescription || '').slice(0, 2000);
      const match = await matchStoryboardProducts({ shotDescription: description, products,
        selectWithModel: products.length > 1 ? prompt => callLLM(prompt, { backend: 'qwen', model: 'qwen-plus', timeoutMs: 30_000 }) : undefined });
      res.json({ ok: true, projectId, shotId, ...match, needsReview: match.source === 'unresolved' || match.confidence < 0.7 });
    });
  }

  return { registerPostFreeCreationHookFirstFrame, registerPostStoryboardProductMatch };
}

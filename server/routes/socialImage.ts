import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import { createSocialImageTask, readSocialImageTask, updateSocialImageTask } from '../socialImage/socialImageTask.js';
import { socialImageDeterministicChecks } from '../socialImage/socialImageQuality.js';
import { SOCIAL_IMAGE_HARD_CHECKS } from '../../shared/contracts/socialImageCreation.js';
import { compileLuxuryProductHero } from '../socialImage/templates/luxuryProductHero.js';
import { assertSocialImageLayerGraph } from '../socialImage/layerGraphValidation.js';
import { renderSocialImageLayerGraph } from '../socialImage/layerRenderer.js';
import { readTenantEnterpriseProfile } from './enterprise.js';
import { enterpriseAssetObjectKey, enterpriseAssetTenantKey } from '../storage/enterpriseAssets.js';
import { objectStorageDownload, objectStorageEnabled } from '../storage/objectStorage.js';

export const socialImageRouter = Router();

const renderRoot = (tenantId: string) => path.resolve(process.cwd(), 'data', 'social-image-renders', enterpriseAssetTenantKey(tenantId));

function productIdentity(product: Record<string, unknown>, index: number) {
  return String(product.id || product.productId || product.sku || `product-${index}-${String(product.name || '')}`);
}

async function enterpriseProductAsset(tenantId: string, productId: string): Promise<{ name: string; bytes: Buffer } | null> {
  const profile = await readTenantEnterpriseProfile(tenantId);
  const products = profile.products.items || [];
  const index = products.findIndex((item, itemIndex) => productIdentity(item as unknown as Record<string, unknown>, itemIndex) === productId);
  const product = index >= 0 ? products[index] : undefined;
  if (!product) return null;
  const url = String(product.images?.[0]?.url || product.imageUrl || '');
  let route = '';
  try { route = new URL(url, 'http://local.invalid').pathname; } catch { return null; }
  const match = route.match(/^\/api\/overseas\/enterprise\/assets\/([\w.-]+)$/);
  if (!match) return null;
  const filename = path.basename(match[1]!);
  const local = path.resolve(process.cwd(), 'data', 'enterprise-assets', enterpriseAssetTenantKey(tenantId), filename);
  if (local.startsWith(path.resolve(process.cwd(), 'data', 'enterprise-assets')) && fs.existsSync(local)) return { name: String(product.name || productId), bytes: fs.readFileSync(local) };
  if (objectStorageEnabled()) {
    const stored = await objectStorageDownload(enterpriseAssetObjectKey(tenantId, filename));
    if (stored?.buf?.length) return { name: String(product.name || productId), bytes: stored.buf };
  }
  return null;
}

socialImageRouter.get('/renders/:filename', (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const filename = String(req.params.filename || '');
  if (!/^[a-zA-Z0-9._-]+\.png$/.test(filename)) { res.status(400).json({ ok: false, error: '成片文件名无效' }); return; }
  const file = path.join(renderRoot(tenantId), filename);
  if (!fs.existsSync(file)) { res.status(404).json({ ok: false, error: '成片不存在' }); return; }
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.type('png').sendFile(file);
});

socialImageRouter.post('/tasks', async (req, res) => {
  try {
    const { tenantId } = res.locals as AuthLocals;
    const task = await createSocialImageTask(store, tenantId, req.body || {});
    res.status(201).json({ ok: true, task });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : '图片任务创建失败' });
  }
});

socialImageRouter.post('/tasks/from-reference', async (req, res) => {
  try {
    const { tenantId } = res.locals as AuthLocals;
    const task = await createSocialImageTask(store, tenantId, { ...(req.body || {}), creationPath: 'viral_replication' });
    res.status(201).json({ ok: true, task });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : '参考作品任务创建失败' });
  }
});

socialImageRouter.get('/tasks/:id', async (req, res) => {
  try {
    const { tenantId } = res.locals as AuthLocals;
    const task = await readSocialImageTask(store, tenantId, req.params.id);
    if (!task) { res.status(404).json({ ok: false, error: '图片任务不存在' }); return; }
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ ok: true, task });
  } catch {
    res.status(503).json({ ok: false, error: '图片任务读取失败' });
  }
});

socialImageRouter.patch('/tasks/:id', async (req, res) => {
  try {
    const { tenantId } = res.locals as AuthLocals;
    const expectedVersion = Number(req.body?.expectedVersion);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) { res.status(400).json({ ok: false, error: '缺少有效任务版本' }); return; }
    const result = await updateSocialImageTask(store, tenantId, req.params.id, expectedVersion, req.body?.patch || {});
    if (result.kind === 'missing') { res.status(404).json({ ok: false, error: '图片任务不存在' }); return; }
    if (result.kind === 'conflict') { res.status(409).json({ ok: false, error: '任务已被更新，请刷新后继续', task: result.task }); return; }
    if (result.kind === 'invalid') { res.status(422).json({ ok: false, error: result.issues.join('；'), issues: result.issues, task: result.task }); return; }
    res.json({ ok: true, task: result.task });
  } catch (error) {
    res.status(503).json({ ok: false, error: error instanceof Error ? error.message : '图片任务保存失败' });
  }
});

socialImageRouter.post('/tasks/:id/compile-layered', async (req, res) => {
  try {
    const { tenantId } = res.locals as AuthLocals;
    const task = await readSocialImageTask(store, tenantId, req.params.id);
    if (!task) { res.status(404).json({ ok: false, error: '图片任务不存在' }); return; }
    if (Number(req.body?.expectedVersion) !== task.version) { res.status(409).json({ ok: false, error: '任务已被更新，请刷新后继续', task }); return; }
    const productId = task.contentBrief.productRefs[0];
    if (!productId) { res.status(422).json({ ok: false, error: '分层编译需要企业知识库产品' }); return; }
    const product = await enterpriseProductAsset(tenantId, productId);
    if (!product) { res.status(422).json({ ok: false, error: '企业产品主图不可读取，未进入渲染' }); return; }
    // Logo is optional during first-draft creation. It can be added later from
    // the unified review surface once a resolvable enterprise asset exists.
    const layerGraph = compileLuxuryProductHero({ task, productId, productName: product.name });
    assertSocialImageLayerGraph(layerGraph);
    const updated = await updateSocialImageTask(store, tenantId, task.id, task.version, { layerGraph, status: 'planned', step: 'generate' });
    if (updated.kind !== 'updated') { res.status(updated.kind === 'conflict' ? 409 : 422).json({ ok: false, error: updated.kind === 'invalid' ? updated.issues.join('；') : '分层合同保存失败' }); return; }
    res.json({ ok: true, task: updated.task, layerGraph });
  } catch (error) {
    res.status(422).json({ ok: false, error: error instanceof Error ? error.message : '分层编译失败' });
  }
});

socialImageRouter.post('/tasks/:id/repair-layered', async (req, res) => {
  try {
    const { tenantId } = res.locals as AuthLocals;
    const task = await readSocialImageTask(store, tenantId, req.params.id);
    if (!task) { res.status(404).json({ ok: false, error: '图片任务不存在' }); return; }
    if (Number(req.body?.expectedVersion) !== task.version) { res.status(409).json({ ok: false, error: '任务已被更新，请刷新后继续', task }); return; }
    if (!task.layerGraph) { res.status(422).json({ ok: false, error: '当前成片没有可修改的分层合同' }); return; }
    const instruction = String(req.body?.instruction || '').trim().slice(0, 1000);
    if (!instruction) { res.status(400).json({ ok: false, error: '请输入修改要求' }); return; }
    const graph = structuredClone(task.layerGraph);
    let nextFieldsToConfirm = [...task.fieldsToConfirm];
    let nextTextContract = { ...task.imageTextContract };
    let targetLayer: 'background' | 'product' | 'logo' | 'typography' | 'full_composite' = 'full_composite';
    const clamp = (value: number, max = 1) => Math.max(0, Math.min(max, value));
    const move = (kind: 'product' | 'overlay', dx: number, dy: number) => graph.layers.filter(layer => layer.kind === kind).forEach(layer => {
      layer.rect.x = clamp(layer.rect.x + dx, 1 - layer.rect.width);
      layer.rect.y = clamp(layer.rect.y + dy, 1 - layer.rect.height);
    });
    if (/产品|瓶|包装/i.test(instruction)) {
      targetLayer = 'product';
      for (const layer of graph.layers.filter(item => item.kind === 'product')) {
        const factor = /小一点|缩小|小些/i.test(instruction) ? .9 : /大一点|放大|大些/i.test(instruction) ? 1.1 : 1;
        if (factor !== 1) {
          const centerX = layer.rect.x + layer.rect.width / 2; const centerY = layer.rect.y + layer.rect.height / 2;
          layer.rect.width = clamp(layer.rect.width * factor, .88);
          layer.rect.height = clamp(layer.rect.height * factor, .84);
          layer.rect.x = clamp(centerX - layer.rect.width / 2, 1 - layer.rect.width);
          layer.rect.y = clamp(centerY - layer.rect.height / 2, 1 - layer.rect.height);
        }
      }
      if (/左移|往左/i.test(instruction)) move('product', -.04, 0);
      if (/右移|往右/i.test(instruction)) move('product', .04, 0);
      if (/上移|往上/i.test(instruction)) move('product', 0, -.04);
      if (/下移|往下/i.test(instruction)) move('product', 0, .04);
    }
    if (/遮罩|蒙版|玻璃/i.test(instruction)) {
      targetLayer = 'background';
      if (/左移|往左/i.test(instruction)) move('overlay', -.04, 0);
      if (/右移|往右/i.test(instruction)) move('overlay', .04, 0);
      if (/上移|往上/i.test(instruction)) move('overlay', 0, -.04);
      if (/下移|往下/i.test(instruction)) move('overlay', 0, .04);
      for (const layer of graph.layers.filter(item => item.kind === 'overlay')) {
        if (/淡一点|透明一点|浅一点/i.test(instruction)) layer.opacity = Math.max(.2, (layer.opacity ?? .72) - .15);
        if (/深一点|明显一点|不透明/i.test(instruction)) layer.opacity = Math.min(.92, (layer.opacity ?? .72) + .15);
      }
    }
    const title = instruction.match(/(?:标题|headline).*?(?:改成|改为|换成)[：:]?\s*(.+)$/i)?.[1]?.trim();
    if (title) {
      targetLayer = 'typography';
      const layer = graph.layers.find(item => item.id === 'headline');
      if (layer) layer.content = title.slice(0, 160);
      nextTextContract = { ...nextTextContract, headline: title.slice(0, 160) };
    }
    if (/删除|去掉|不要/.test(instruction) && /认证|资质|产地|泰国|MOQ|起订|交期|价格|工厂|OEM|ODM/i.test(instruction)) {
      targetLayer = 'typography';
      const sensitive = /[^。！？.!?\n]*(?:认证|资质|产地|泰国|MOQ|起订|交期|价格|工厂|OEM|ODM)[^。！？.!?\n]*[。！？.!?]?/gi;
      graph.layers = graph.layers.filter(layer => layer.kind !== 'badge').map(layer => (layer.kind === 'text' || layer.kind === 'cta') && layer.content
        ? { ...layer, content: layer.content.replace(sensitive, '').trim() }
        : layer).filter(layer => !((layer.kind === 'text' || layer.kind === 'cta') && !layer.content));
      const requestedKinds = [
        /认证|资质/i.test(instruction) ? /认证|资质|certif/i : null,
        /产地|泰国/i.test(instruction) ? /产地|国家|泰国|origin|country/i : null,
        /MOQ|起订/i.test(instruction) ? /MOQ|起订|minimum order/i : null,
        /交期/i.test(instruction) ? /交期|周转|lead time|turnaround/i : null,
        /价格/i.test(instruction) ? /价格|price/i : null,
        /工厂/i.test(instruction) ? /工厂|产能|factory/i : null,
        /OEM|ODM/i.test(instruction) ? /OEM|ODM|私标|定制/i : null,
      ].filter(Boolean) as RegExp[];
      nextFieldsToConfirm = nextFieldsToConfirm.filter(field => !requestedKinds.some(pattern => pattern.test(field)));
      nextTextContract = {
        ...nextTextContract,
        headline: nextTextContract.headline.replace(sensitive, '').trim(),
        supportingText: nextTextContract.supportingText?.replace(sensitive, '').trim(),
        caption: nextTextContract.caption.replace(sensitive, '').trim(),
        cta: nextTextContract.cta?.replace(sensitive, '').trim(),
        hashtags: nextTextContract.hashtags.filter(item => !requestedKinds.some(pattern => pattern.test(item))),
      };
    }
    if (targetLayer === 'full_composite') { res.status(422).json({ ok: false, error: '暂未识别这条修改要求，请描述产品大小/位置、遮罩、标题或删除敏感声明。' }); return; }
    assertSocialImageLayerGraph(graph);
    const repair = {
      id: randomUUID(), outputNodeId: task.outputs.at(-1)?.id || '', failedChecks: [], targetLayer,
      instruction, status: 'completed' as const, fromVersion: Math.max(1, ...task.outputs.map(item => item.version)),
    };
    const updated = await updateSocialImageTask(store, tenantId, task.id, task.version, {
      layerGraph: graph, status: 'planned', step: 'generate', repairInstructions: [...task.repairInstructions, repair],
      fieldsToConfirm: nextFieldsToConfirm, imageTextContract: nextTextContract,
    });
    if (updated.kind !== 'updated') { res.status(updated.kind === 'conflict' ? 409 : 422).json({ ok: false, error: updated.kind === 'invalid' ? updated.issues.join('；') : '图层修改保存失败' }); return; }
    res.json({ ok: true, task: updated.task, layerGraph: graph, targetLayer });
  } catch (error) {
    res.status(422).json({ ok: false, error: error instanceof Error ? error.message : '图层修改失败' });
  }
});

socialImageRouter.post('/tasks/:id/render-layered', async (req, res) => {
  try {
    const { tenantId } = res.locals as AuthLocals;
    const task = await readSocialImageTask(store, tenantId, req.params.id);
    if (!task) { res.status(404).json({ ok: false, error: '图片任务不存在' }); return; }
    if (Number(req.body?.expectedVersion) !== task.version) { res.status(409).json({ ok: false, error: '任务已被更新，请刷新后继续', task }); return; }
    if (!task.layerGraph) { res.status(422).json({ ok: false, error: '任务尚未生成分层合同' }); return; }
    // Unresolved optional layers are omitted from the first draft instead of
    // stopping production. The user can add them later from unified review.
    const renderGraph = {
      ...task.layerGraph,
      layers: task.layerGraph.layers.filter(item => item.kind !== 'logo'),
    };
    assertSocialImageLayerGraph(renderGraph);
    const assets = new Map<string, Buffer>();
    for (const layer of renderGraph.layers.filter(item => item.kind === 'product')) {
      const product = layer.sourceAssetId ? await enterpriseProductAsset(tenantId, layer.sourceAssetId) : null;
      if (!product || !layer.sourceAssetId) { res.status(422).json({ ok: false, error: `企业产品资产不可读取：${layer.id}` }); return; }
      assets.set(layer.sourceAssetId, product.bytes);
    }
    const rendered = await renderSocialImageLayerGraph({ graph: renderGraph, assets });
    const digest = createHash('sha256').update(rendered.bytes).digest('hex');
    const filename = `${task.id}-v${task.version}-${digest.slice(0, 12)}.png`;
    const directory = renderRoot(tenantId);
    fs.mkdirSync(directory, { recursive: true });
    const target = path.join(directory, filename);
    if (!fs.existsSync(target)) {
      const temporary = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, rendered.bytes, { mode: 0o600 });
      fs.renameSync(temporary, target);
    }
    const mediaUrl = `/api/overseas/social-images/renders/${filename}`;
    const outputVersion = Math.max(0, ...task.outputs.filter(item => item.role === 'single' && item.label === '分层主视觉').map(item => item.version)) + 1;
    const output = {
      id: randomUUID(), role: 'single' as const, label: '分层主视觉', state: 'quality_checking' as const,
      mediaUrl, version: outputVersion,
      qualityChecks: SOCIAL_IMAGE_HARD_CHECKS.map(key => ({ key, verdict: 'uncertain' as const, severity: 'hard' as const, checker: 'deterministic' as const, note: '等待分层成片质检' })),
    };
    const updated = await updateSocialImageTask(store, tenantId, task.id, task.version, {
      status: 'review_required', step: 'review', layerGraph: renderGraph,
      outputs: [...task.outputs.map(item => item.role === output.role && item.label === output.label ? { ...item, state: 'superseded' as const } : item), output],
    });
    if (updated.kind !== 'updated') { res.status(updated.kind === 'conflict' ? 409 : 422).json({ ok: false, error: updated.kind === 'invalid' ? updated.issues.join('；') : '分层成片保存失败' }); return; }
    res.json({ ok: true, task: updated.task, layerGraph: renderGraph, url: mediaUrl, sha256: digest, mimeType: rendered.mimeType });
  } catch (error) {
    res.status(422).json({ ok: false, error: error instanceof Error ? error.message : '分层渲染失败' });
  }
});

socialImageRouter.post('/tasks/:id/quality/preflight', async (req, res) => {
  try {
    const { tenantId } = res.locals as AuthLocals;
    const task = await readSocialImageTask(store, tenantId, req.params.id);
    if (!task) { res.status(404).json({ ok: false, error: '图片任务不存在' }); return; }
    const expectedVersion = Number(req.body?.expectedVersion);
    if (expectedVersion !== task.version) { res.status(409).json({ ok: false, error: '任务已被更新，请刷新后继续', task }); return; }
    const checks = socialImageDeterministicChecks(task);
    const outputs = task.outputs.map(output => ({ ...output, qualityChecks: checks }));
    const result = await updateSocialImageTask(store, tenantId, task.id, task.version, { outputs, status: 'review_required', step: 'review' });
    if (result.kind !== 'updated') { res.status(result.kind === 'conflict' ? 409 : 422).json({ ok: false, error: result.kind === 'invalid' ? result.issues.join('；') : '质检结果保存失败' }); return; }
    res.json({ ok: true, task: result.task, checks });
  } catch (error) {
    res.status(503).json({ ok: false, error: error instanceof Error ? error.message : '自动预检失败' });
  }
});

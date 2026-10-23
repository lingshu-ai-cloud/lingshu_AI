import { createShootingTasksRouter } from './shootingTasks.js';
import { createProductionCostQuotesRouter, createProductionInputRequestsRouter } from './productionGovernance.js';
import { createStudioAvatarProductionRouter } from '../lib/studioAvatarProduction.js';
import { callLLM } from '../agents/llm.js';
import { store } from '../storage/index.js';
import { getTenantSubscription, isEntitled, isSubscriptionEnforced } from '../middleware/subscription.js';
import { isReferenceOnlyMaterial } from '../lib/materialPolicy.js';
import { type AuthLocals } from '../middleware/auth.js';

import type { StudioApplicationPorts } from '../studio/applicationPorts.js';

export function createStudioWorkspaceAdmissionRoutes(deps: Pick<StudioApplicationPorts, 'studioRouter' | 'loadMaterials'>) {
  const studioRouter = deps.studioRouter;
  const loadMaterials: StudioApplicationPorts['loadMaterials'] = (...args) => deps.loadMaterials(...args);

  function registerPostMapProductColumns() {
    studioRouter.post('/map-product-columns', async (req, res) => {
      const headers = Array.isArray(req.body?.headers) ? req.body.headers.map(String) : [];
      const sampleRows = Array.isArray(req.body?.sampleRows) ? req.body.sampleRows.slice(0, 5) : [];
      const candidateRows = Array.isArray(req.body?.candidateRows)
        ? req.body.candidateRows.slice(0, 10).map((row: unknown) => Array.isArray(row) ? row.map(String) : [])
        : [];
      const currentHeaderRowIndex = Number.isInteger(req.body?.currentHeaderRowIndex) ? Number(req.body.currentHeaderRowIndex) : 0;
      if (!headers.length) {
        res.status(400).json({ ok: false, error: 'headers required' });
        return;
      }

      const allowed = new Set(['sku', 'name', 'color', 'size', 'tagPrice', 'retailPrice', 'moq', 'brand', 'material', 'imageUrl', 'highlights', '']);
      try {
        const text = await callLLM(JSON.stringify({ headers, sampleRows, candidateRows, currentHeaderRowIndex }), {
          systemPrompt: `你是 B2B 商品表格字段映射助手。先检查 currentHeaderRowIndex 指向的是否是真正表头；如果 headers 看起来是货号、商品内容或数字而不是列名，就从 candidateRows 中找出真正表头的 0 基行号。然后根据表头和前 5 行样本，把客户列名映射到产品 schema。
真正表头通常包含货号、品名、颜色、尺码、价格、材质、图片等字段名；公司抬头、Logo、大标题和第一条商品数据都不是表头。
可用目标字段：
- sku: 货号/款号/SKU/商品编码，用于 upsert 去重
- name: 商品名称
- color: 颜色
- size: 尺码/规格
- tagPrice: 吊牌价/标签价
- retailPrice: 零售价/建议零售价
- moq: 起订量/最小订单量
- brand: 品牌
- material: 面料/材质/成分
- imageUrl: 图片 URL/主图链接
- highlights: 一句话卖点/描述
不确定或无关列映射为空字符串。只输出 JSON，不要 markdown。headerRowIndex 必须是 candidateRows 的 0 基行号；当前表头正确时沿用 currentHeaderRowIndex。格式：
{"headerRowIndex":2,"mapping":{"客户列名":"sku"},"notes":"简短说明"}`,
        });
        const match = text.match(/\{[\s\S]*\}/);
        const parsed = match ? JSON.parse(match[0]) as { headerRowIndex?: unknown; mapping?: Record<string, unknown>; notes?: unknown } : {};
        const mapping: Record<string, string> = {};
        for (const header of headers) {
          const value = parsed.mapping?.[header];
          mapping[header] = typeof value === 'string' && allowed.has(value) ? value : '';
        }
        const headerRowIndex = Number.isInteger(parsed.headerRowIndex)
          && Number(parsed.headerRowIndex) >= 0
          && Number(parsed.headerRowIndex) < candidateRows.length
          ? Number(parsed.headerRowIndex)
          : currentHeaderRowIndex;
        res.json({ ok: true, headerRowIndex, mapping, notes: typeof parsed.notes === 'string' ? parsed.notes : '' });
      } catch (error) {
        res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });
  }

  function registerGetSubscription() {
    studioRouter.get('/subscription', async (req, res) => {
      const enforced = isSubscriptionEnforced();

      // 未启用强制：一律视为有权限（保持开放）
      if (!enforced) {
        res.json({ ok: true, enforced: false, entitled: true, status: 'active', plan: null, expiresAt: null });
        return;
      }

      const { tenantId } = res.locals as AuthLocals;
      const sub = await getTenantSubscription(tenantId);
      res.json({
        ok: true,
        enforced: true,
        entitled: isEntitled(sub),
        status: sub.status,
        plan: sub.plan,
        expiresAt: sub.expiresAt,
      });
    });
  }

  function registerShootingTasksRouter() {
    studioRouter.use('/shooting-tasks', createShootingTasksRouter(store, async (id, tenantId) => {
      return loadMaterials().some(item => item.id === id && item.tenantId === tenantId && item.type === 'video' && !isReferenceOnlyMaterial(item));
    }));
  }

  function registerProductionInputRequestsRouter() {
    studioRouter.use('/production-input-requests', createProductionInputRequestsRouter(store));
  }

  function registerProductAssetRequestsRouter() {
    studioRouter.use('/product-asset-requests', createProductionInputRequestsRouter(store, { productOnly: true }));
  }

  function registerProductionCostQuotesRouter() {
    studioRouter.use('/production-cost-quotes', createProductionCostQuotesRouter(store));
  }

  function registerStudioAvatarProductionRouter() {
    studioRouter.use('/production', createStudioAvatarProductionRouter(store));
  }

  return { registerPostMapProductColumns, registerGetSubscription, registerShootingTasksRouter, registerProductionInputRequestsRouter, registerProductAssetRequestsRouter, registerProductionCostQuotesRouter, registerStudioAvatarProductionRouter };
}

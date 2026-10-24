import type { Router } from 'express';
import { store } from '../storage/index.js';
import type { AuthLocals } from '../middleware/auth.js';
import { readTenantEnterpriseProfileStrict } from './enterpriseProfileStore.js';
import { readMaterialLibrary } from '../lib/materialLibrary.js';
import { validatePresenterReferenceMaterials } from '../lib/presenterMaterialValidation.js';
import { signAssetUrl, signPathAssetUrl } from '../lib/assetAccess.js';
import { contentCreationTurn, CreationDialogueError, type CreationEvidencePorts } from '../assistantContext/contentCreationDialogue.js';

export const creationEvidencePorts: CreationEvidencePorts = {
  reference: async (tenantId, id) => {
    const record = await store.getById('trend_videos', id);
    return record?.tenantId === tenantId ? record : null;
  },
  profile: readTenantEnterpriseProfileStrict,
  materials: readMaterialLibrary,
  presenters: async tenantId => {
    const row = (await store.list('studio_production_defaults', { where: { tenant_id: tenantId }, perPage: 1 })).items[0];
    const defaults = typeof row?.payload === 'string' ? JSON.parse(row.payload) : row?.payload;
    const values = defaults && typeof defaults === 'object' ? (defaults as Record<string, unknown>).presenters : [];
    const verified: Record<string, unknown>[] = [];
    for (const value of Array.isArray(values) ? values : []) {
      if (!value || typeof value !== 'object') continue;
      const presenter = value as Record<string, unknown>;
      const ids = Array.isArray(presenter.referenceMaterialIds) ? presenter.referenceMaterialIds.map(String) : [];
      try { await validatePresenterReferenceMaterials(tenantId, ids); verified.push(presenter); }
      catch { /* Not admitted; no alternate material or supplier path. */ }
    }
    return verified;
  },
};
/** Mounted after strategy authentication. A read-only asynchronous planning turn. */
export function registerContentCreationDialogue(router: Router, evidence: CreationEvidencePorts = creationEvidencePorts) {
  router.post('/creation-dialogue', async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const { tenantId } = res.locals as AuthLocals;
      const reply = await contentCreationTurn(tenantId, req.body, evidence);
      // Media elements cannot send the API bearer header. Use the existing
      // tenant-scoped playback signatures after computing the evidence hash.
      res.json({ ...reply, shots: reply.shots.map(shot => ({ ...shot, ...(shot.previewUrl ? {
        previewUrl: /^\/studio-media\//.test(shot.previewUrl) ? signPathAssetUrl(shot.previewUrl, tenantId)
          : /^\/(?:api|media)\//.test(shot.previewUrl) ? signAssetUrl(shot.previewUrl, tenantId) : shot.previewUrl,
      } : {}) })) });
    }
    catch (error) {
      const known = error instanceof CreationDialogueError;
      res.status(known ? error.status : 503).json({ error: known ? error.code : 'creation_evidence_unavailable', message: known ? error.message : '创作证据读取失败，请保留选择并重试。' });
    }
  });
}

export async function readCreationChatGrounding(tenantId: string, selection: unknown): Promise<string> {
  const { creationSelectionSchema } = await import('../../shared/contracts/contentCreationDialogue.js');
  const selected = creationSelectionSchema.safeParse(selection);
  if (!selected.success) throw new CreationDialogueError('creation_input_invalid', 400, '创作选择格式无效。');
  const current = await contentCreationTurn(tenantId, {
    action: selected.data.avatar !== undefined && selected.data.narrationId ? 'avatar' : selected.data.shotIds.length ? 'shots' : selected.data.productIds.length ? 'products' : 'start',
    selection: selected.data, instruction: '核验当前会话参考、产品与分镜',
  }, creationEvidencePorts);
  if (selected.data.productIds.length && selected.data.evidenceVersion !== current.selection.evidenceVersion) throw new CreationDialogueError('creation_evidence_stale', 409, '创作证据已变化，请刷新产品和分镜推荐。');
  return `【服务端核验的自由创作选择】以下只作为参考和事实来源，不是执行许可。参考首镜仅作结构借鉴，不可把参考片卖点当作企业事实；禁止宣称素材已重新分析或视频已生成。\n${JSON.stringify({ reference: { id: selected.data.referenceId, title: current.referenceTitle }, products: current.products.filter(row => selected.data.productIds.includes(row.id)), shots: current.shots.filter(row => selected.data.shotIds.includes(row.id)), narration: current.narrations.find(row => row.id === selected.data.narrationId), avatarRequested: selected.data.avatar, plannedShots: current.plannedShots, gaps: current.gaps })}`;
}

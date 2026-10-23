import type { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { store } from '../storage/index.js';
import { verifiedStudioGenerationFromSpec } from '../lib/studioGenerationVerification.js';
import type { StudioMaterialPublishLink } from '../lib/materialUsageTracking.js';
import type { AuthLocals } from '../middleware/auth.js';

const PUBLISH_LINKS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data/studio-publish-links.json');

export function loadStudioPublishLinks(tenantId: string, publishLinksFile = PUBLISH_LINKS_FILE): StudioMaterialPublishLink[] {
  try {
    const rows = JSON.parse(fs.readFileSync(publishLinksFile, 'utf8')) as Array<StudioMaterialPublishLink & { tenantId?: string }>;
    return Array.isArray(rows) ? rows.filter(item => item.tenantId === tenantId) : [];
  } catch {
    return [];
  }
}

export function terminalPublishedPlatformPostId(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const result = value as Record<string, unknown>;
  if (result.ok !== true || result.deliveryStatus !== 'published') return '';
  return String(result.platformPostId || '').trim();
}

export function registerStudioPublishLinkRoutes(router: Router, publishLinksFile = PUBLISH_LINKS_FILE): void {
  router.get('/publish-links', (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    try { res.json((JSON.parse(fs.readFileSync(publishLinksFile, 'utf8')) as any[]).filter(item => item.tenantId === tenantId)); } catch { res.json([]); }
  });
  router.post('/publish-links', async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    const projectId = String(req.body?.projectId || '').trim();
    if (!projectId) { res.status(400).json({ ok: false, error: 'projectId required' }); return; }
    if (!terminalPublishedPlatformPostId(req.body?.publishResult)) {
      res.status(409).json({ ok: false, error: 'publishResult must contain a terminal published platform receipt' });
      return;
    }
    let project: Record<string, unknown> | null;
    try { project = await store.getById<Record<string, unknown>>('studio_projects', projectId); }
    catch { res.status(503).json({ ok: false, error: '无法验证 Studio 生成记录，请稍后重试' }); return; }
    if (!project || String(project.tenant_id || '') !== tenantId) {
      res.status(404).json({ ok: false, error: '当前企业的 Studio 项目不存在' });
      return;
    }
    const generation = verifiedStudioGenerationFromSpec(project.spec, req.body);
    if (!generation.ok) {
      res.status(409).json({ ok: false, error: generation.code, message: generation.message });
      return;
    }
    let list: Record<string, unknown>[] = []; try { list = JSON.parse(fs.readFileSync(publishLinksFile, 'utf8')) as Record<string, unknown>[]; } catch { /* empty */ }
    const link = { id: randomUUID(), tenantId, projectId, batchId: req.body?.batchId ? String(req.body.batchId) : undefined, variantId: req.body?.variantId ? String(req.body.variantId) : undefined, accountId: String(req.body?.accountId || ''), platform: String(req.body?.platform || ''), title: String(req.body?.title || ''), publishResult: req.body.publishResult, publishedAt: new Date().toISOString() };
    list.push(link); fs.mkdirSync(path.dirname(publishLinksFile), { recursive: true }); fs.writeFileSync(publishLinksFile, JSON.stringify(list, null, 2), 'utf8'); res.status(201).json({ ok: true, link });
  });
  router.patch('/publish-links/:id/metrics', (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    let list: Record<string, any>[] = []; try { list = JSON.parse(fs.readFileSync(publishLinksFile, 'utf8')) as Record<string, any>[]; } catch { /* empty */ }
    const link = list.find(item => item.id === req.params.id && item.tenantId === tenantId); if (!link) { res.status(404).json({ ok: false, error: 'Publish link not found' }); return; }
    link.metrics = { views: Number(req.body?.views) || 0, likes: Number(req.body?.likes) || 0, comments: Number(req.body?.comments) || 0, shares: Number(req.body?.shares) || 0, leads: Number(req.body?.leads) || 0, updatedAt: new Date().toISOString() };
    fs.writeFileSync(publishLinksFile, JSON.stringify(list, null, 2), 'utf8'); res.json({ ok: true, link });
  });
  router.get('/publish-performance', (_req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    let list: Record<string, any>[] = []; try { list = JSON.parse(fs.readFileSync(publishLinksFile, 'utf8')) as Record<string, any>[]; } catch { /* empty */ }
    const grouped: Record<string, any> = {};
    for (const link of list.filter(item => item.tenantId === tenantId)) { const key = String(link.projectId || 'unknown'); const row = grouped[key] ||= { projectId: key, posts: 0, views: 0, likes: 0, comments: 0, shares: 0, leads: 0 }; row.posts += 1; for (const metric of ['views', 'likes', 'comments', 'shares', 'leads']) row[metric] += Number(link.metrics?.[metric]) || 0; }
    res.json(Object.values(grouped).map((row: any) => ({ ...row, engagementRate: row.views ? Math.round(((row.likes + row.comments + row.shares) / row.views) * 10000) / 100 : 0 })).sort((a: any, b: any) => b.views - a.views));
  });

}

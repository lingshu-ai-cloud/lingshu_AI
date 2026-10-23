import type { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { AuthLocals } from '../middleware/auth.js';

/* ── 爆款裂变批量队列：持久化组合、执行状态与人工审核结果 ─────────────── */
const BATCHES_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data/studio-variation-batches.json');
type BatchItemStatus = 'pending' | 'running' | 'quality_check' | 'review' | 'approved' | 'rejected' | 'failed';
interface VariationBatchItem { id: string; variables: Record<string, string>; status: BatchItemStatus; outputProjectId?: string; qualityScore?: number; note?: string; updatedAt: string }
interface VariationBatch { id: string; tenantId: string; title: string; templateProjectId?: string; status: 'queued' | 'running' | 'review' | 'completed' | 'paused'; estimatedCostCny: number; plan?: Record<string, unknown>; createdAt: string; updatedAt: string; items: VariationBatchItem[] }

export function registerStudioVariationBatchRoutes(router: Router, batchesFile = BATCHES_FILE): void {
  function loadVariationBatches(): VariationBatch[] { try { return JSON.parse(fs.readFileSync(batchesFile, 'utf8')) as VariationBatch[]; } catch { return []; } }
  function persistVariationBatches(list: VariationBatch[]): void { fs.mkdirSync(path.dirname(batchesFile), { recursive: true }); fs.writeFileSync(batchesFile, JSON.stringify(list, null, 2), 'utf8'); }

  router.get('/variation-batches', (_req, res) => { const { tenantId } = res.locals as AuthLocals; res.json(loadVariationBatches().filter(item => item.tenantId === tenantId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); });
  router.post('/variation-batches', (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    const body = req.body ?? {};
    const dimensions = body.dimensions && typeof body.dimensions === 'object' ? body.dimensions as Record<string, unknown> : {};
    const values = (key: string) => Array.isArray(dimensions[key]) && (dimensions[key] as unknown[]).length ? (dimensions[key] as unknown[]).map(String) : ['默认'];
    const products = values('product'); const people = values('person'); const scenes = values('scene'); const languages = values('language'); const hooks = values('hook');
    const limit = Math.max(1, Math.min(200, Number(body.maxItems) || 20));
    const now = new Date().toISOString(); const items: VariationBatchItem[] = [];
    outer: for (const product of products) for (const person of people) for (const scene of scenes) for (const language of languages) for (const hook of hooks) {
      items.push({ id: randomUUID(), variables: { product, person, scene, language, hook }, status: 'pending', updatedAt: now });
      if (items.length >= limit) break outer;
    }
    const duration = Math.max(1, Number(body.duration) || 20);
    const batch: VariationBatch = { id: randomUUID(), tenantId, title: String(body.title || '未命名裂变批次'), templateProjectId: body.templateProjectId ? String(body.templateProjectId) : undefined, status: 'queued', estimatedCostCny: Math.ceil(items.length * duration * 1.5 * 100) / 100, plan: body.plan && typeof body.plan === 'object' ? body.plan as Record<string, unknown> : { duration, maxItems: limit, dimensions }, createdAt: now, updatedAt: now, items };
    const list = loadVariationBatches(); list.push(batch); persistVariationBatches(list); res.status(201).json({ ok: true, batch });
  });
  router.patch('/variation-batches/:batchId', (req, res) => {
    const { tenantId } = res.locals as AuthLocals; const list = loadVariationBatches(); const batch = list.find(item => item.id === req.params.batchId && item.tenantId === tenantId);
    if (!batch) { res.status(404).json({ ok: false, error: 'Batch not found' }); return; }
    if (['queued', 'running', 'review', 'completed', 'paused'].includes(String(req.body?.status))) batch.status = req.body.status;
    batch.updatedAt = new Date().toISOString(); persistVariationBatches(list); res.json({ ok: true, batch });
  });
  router.patch('/variation-batches/:batchId/items/:itemId', (req, res) => {
    const { tenantId } = res.locals as AuthLocals; const list = loadVariationBatches(); const batch = list.find(entry => entry.id === req.params.batchId && entry.tenantId === tenantId); const item = batch?.items.find(entry => entry.id === req.params.itemId);
    if (!batch || !item) { res.status(404).json({ ok: false, error: 'Batch item not found' }); return; }
    const allowed: BatchItemStatus[] = ['pending', 'running', 'quality_check', 'review', 'approved', 'rejected', 'failed'];
    if (allowed.includes(req.body?.status)) item.status = req.body.status;
    if (req.body?.outputProjectId) item.outputProjectId = String(req.body.outputProjectId);
    if (Number.isFinite(Number(req.body?.qualityScore))) item.qualityScore = Number(req.body.qualityScore);
    if (typeof req.body?.note === 'string') item.note = req.body.note;
    item.updatedAt = new Date().toISOString(); batch.updatedAt = item.updatedAt;
    if (batch.items.every(entry => entry.status === 'approved' || entry.status === 'rejected')) batch.status = 'completed'; else if (batch.items.some(entry => entry.status === 'review')) batch.status = 'review';
    persistVariationBatches(list); res.json({ ok: true, batch, item });
  });
  router.post('/variation-batches/:batchId/claim-next', (req, res) => {
    const { tenantId } = res.locals as AuthLocals; const list = loadVariationBatches(); const batch = list.find(entry => entry.id === req.params.batchId && entry.tenantId === tenantId);
    if (!batch) { res.status(404).json({ ok: false, error: 'Batch not found' }); return; }
    if (batch.status === 'paused' || batch.status === 'completed') { res.json({ ok: true, item: null, batch }); return; }
    const staleBefore = Date.now() - 30 * 60 * 1000;
    const item = batch.items.find(entry => entry.status === 'pending' || (entry.status === 'running' && new Date(entry.updatedAt).getTime() < staleBefore));
    if (!item) { batch.status = batch.items.some(entry => entry.status === 'review') ? 'review' : batch.status; persistVariationBatches(list); res.json({ ok: true, item: null, batch }); return; }
    item.status = 'running'; item.updatedAt = new Date().toISOString(); batch.status = 'running'; batch.updatedAt = item.updatedAt; persistVariationBatches(list); res.json({ ok: true, item, batch });
  });
  router.post('/variation-batches/:batchId/retry-failed', (req, res) => {
    const { tenantId } = res.locals as AuthLocals; const list = loadVariationBatches(); const batch = list.find(entry => entry.id === req.params.batchId && entry.tenantId === tenantId);
    if (!batch) { res.status(404).json({ ok: false, error: 'Batch not found' }); return; }
    let count = 0; const now = new Date().toISOString(); batch.items.forEach(item => { if (item.status === 'failed' || item.status === 'rejected') { item.status = 'pending'; item.updatedAt = now; count += 1; } });
    if (count) batch.status = 'queued'; batch.updatedAt = now; persistVariationBatches(list); res.json({ ok: true, retried: count, batch });
  });

}

import { createHash } from 'node:crypto';
import { Router, json, type Request, type Response } from 'express';
import type { DataStore, Record_, Where } from '../storage/datastore.js';
import { enforceSupportSessionReadOnly, type AuthLocals } from '../middleware/auth.js';
import { DIGITAL_EMPLOYEE_COLLECTION as C, jsonObject } from './digitalEmployeeRecords.js';
import { visibleDigitalEmployeeAgentRole } from '../digitalEmployees/agentRoles.js';
import { starterWorkspaceQueue, type MobileWorkbenchProductAdapter } from './mobileWorkbenchProductAdapter.js';

const STATE = 'mobile_workbench_snoozes';
function queueFailure(res: Response, error: unknown, fallback: string) {
  const code = error instanceof Error ? error.message : '';
  if (['starter_198_role_required', 'starter_198_workspace_not_entitled'].includes(code)) {
    res.status(403).json({ error: code });
    return;
  }
  res.status(503).json({ error: fallback });
}
async function all(store: DataStore, collection: string, where: Where): Promise<Record_[]> {
  const items: Record_[] = [];
  for (let page = 1; ; page++) {
    const result = await store.list<Record_>(collection, { where, sort: 'id', page, perPage: 200 });
    items.push(...result.items.filter(i => Object.entries(where).every(([key, value]) => i[key] === value)));
    if (page >= result.totalPages) return items;
  }
}
// Authentication must be installed by the parent router. Never accept scope from the client.
export function createMobileWorkbenchQueueRouter(store: DataStore, starterSource?: ((req: Request, res: Response) => Promise<Record<string, any>>) | MobileWorkbenchProductAdapter) {
  const router = Router();
  router.use(enforceSupportSessionReadOnly);
  router.get('/queue', async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    try {
      const productAdapter = starterSource && typeof starterSource !== 'function' ? starterSource : null;
      const useStarter = productAdapter ? await productAdapter.kind(req, res) === 'starter_198' : Boolean(starterSource);
      if (useStarter) {
        const workspace = productAdapter ? await productAdapter.starterWorkspace(req, res) : await (starterSource as (req: Request, res: Response) => Promise<Record<string, any>>)(req, res);
        const states = await all(store, STATE, { tenant_id: tenantId, user_id: userId });
        res.setHeader('Cache-Control', 'private, no-store');
        const snoozes = Object.fromEntries(states.filter(s => Number(s.until) > Date.now()).map(s => [String(s.matter_id), Number(s.until)]));
        // Function sources are the existing starter-only internal route. Keep
        // its compatibility envelope while the unified product adapter emits
        // the public mobile-workbench contract.
        res.json(productAdapter ? { ...starterWorkspaceQueue(workspace), snoozes } : { workspace, snoozes });
        return;
      }
      const [tasks, approvals, shoots, states] = await Promise.all([
        all(store, C.tasks, { tenant_id: tenantId }),
        all(store, C.approvals, { tenant_id: tenantId, status: 'pending' }),
        all(store, 'studio_shooting_tasks', { tenant_id: tenantId }),
        all(store, STATE, { tenant_id: tenantId, user_id: userId }),
      ]);
      const unresolved = tasks.filter(t => !['succeeded', 'cancelled', 'skipped'].includes(String(t.status)));
      const ids = new Set(unresolved.map(t => t.id));
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ tasks: unresolved.map(t => ({ ...t, output: jsonObject(t.output, {}), agent_role: visibleDigitalEmployeeAgentRole(String(t.agent_role || ''), String(t.task_key || '')) })),
        approvals: approvals.filter(a => ids.has(String(a.task_id))),
        shooting: shoots.map(s => ({ ...jsonObject<Record<string, unknown>>(s.payload, {}), id: s.id })),
        snoozes: Object.fromEntries(states.filter(s => Number(s.until) > Date.now()).map(s => [String(s.matter_id), Number(s.until)])),
        generatedAt: new Date().toISOString(), scope: 'authenticated_tenant',
      });
    } catch (error) { queueFailure(res, error, '工作台待处理队列读取失败，请检查服务版本和存储配置'); }
  });
  router.post('/snooze', json({ limit: '8kb' }), async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const { matterId, until } = req.body || {};
    const match = typeof matterId === 'string' && /^(approval|task|shoot|starter):([A-Za-z0-9:_-]{1,200})$/.exec(matterId);
    if (!match || !Number.isSafeInteger(until) || (until !== 0 && (until <= Date.now() || until > Date.now() + 7 * 86400000))) {
      res.status(400).json({ error: '事项或稍后时间无效' }); return;
    }
    try {
      const productAdapter = starterSource && typeof starterSource !== 'function' ? starterSource : null;
      const useStarter = productAdapter ? await productAdapter.kind(req, res) === 'starter_198' : Boolean(starterSource);
      if (useStarter) {
        if (match[1] !== 'starter') { res.status(400).json({ error: '事项类型无效' }); return; }
        const w = productAdapter ? await productAdapter.starterWorkspace(req, res) : await (starterSource as (req: Request, res: Response) => Promise<Record<string, any>>)(req, res);
        const items = [...(w.decisions || []), ...(w.today?.nextSteps || []), ...(w.today?.inProgress || [])];
        if (!items.some(i => i.id === match[2])) { res.status(404).json({ error: '事项不存在或已处理' }); return; }
      } else {
        if (match[1] === 'starter') { res.status(400).json({ error: '事项类型无效' }); return; }
        const collection = match[1] === 'approval' ? C.approvals : match[1] === 'task' ? C.tasks : 'studio_shooting_tasks';
        const subject = await store.getById<Record_>(collection, match[2]);
        if (!subject || subject.tenant_id !== tenantId) { res.status(404).json({ error: '事项不存在' }); return; }
        // Undo is permitted after a matter completes; creating a new snooze is not.
        if (until !== 0) {
          let actionable = match[1] === 'task' ? ['failed', 'handed_off'].includes(String(subject.status))
            : match[1] === 'approval' ? subject.status === 'pending'
            : !(jsonObject<{ uploadedMaterialIds?: unknown[] }>(subject.payload, {}).uploadedMaterialIds?.length);
          if (actionable && match[1] === 'approval') {
            const task = await store.getById<Record_>(C.tasks, String(subject.task_id));
            actionable = Boolean(task && task.tenant_id === tenantId && !['succeeded', 'cancelled', 'skipped'].includes(String(task.status)));
          }
          if (!actionable) { res.status(409).json({ error: '事项已处理或无需人工操作，请刷新队列' }); return; }
        }
      }
      const id = createHash('sha256').update(JSON.stringify([tenantId, userId, matterId])).digest('hex').slice(0, 15);
      const saved = await store.getById<Record_>(STATE, id);
      if (saved && (saved.tenant_id !== tenantId || saved.user_id !== userId || saved.matter_id !== matterId)) throw Error('scope conflict');
      const data = { tenant_id: tenantId, user_id: userId, matter_id: matterId, until, updated_at: new Date().toISOString() };
      let ok = false;
      if (saved) ok = await store.update(STATE, id, data);
      else {
        try { ok = Boolean(await store.create(STATE, { id, ...data })); }
        catch { /* A competing insert may have won the same primary key. Verify below. */ }
      }
      // Concurrent first writes use the same unique primary key; retry only an exact scoped record.
      if (!ok) {
        const concurrent = await store.getById<Record_>(STATE, id);
        if (concurrent?.tenant_id === tenantId && concurrent.user_id === userId && concurrent.matter_id === matterId) ok = await store.update(STATE, id, data);
      }
      if (!ok) throw Error('storage unavailable');
      res.json({ matterId, until });
    } catch (error) { queueFailure(res, error, '稍后设置未保存，请重试'); }
  });
  return router;
}

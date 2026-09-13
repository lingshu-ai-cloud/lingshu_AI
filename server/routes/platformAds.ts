import { Router, type RequestHandler } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { createPlatformAdTask, getPlatformAdTask, listPlatformAdTasks, PlatformAdTaskValidationError, PlatformAdTaskConflictError, updatePlatformAdTask, changePlatformAdManagement } from '../platformAds/tasks.js';
import { createAiPlatformAdPlan } from '../platformAds/planning.js';
import { requestOrganizationRoleStrict } from './auth.js';
import { isBrowserReadToken } from '../digitalEmployees/browserReadSession.js';
import { listAdAutomationRules, saveAdAutomationRule, AD_AUTOMATION_RUNS } from '../platformAds/automation.js';
import { store } from '../storage/index.js';
import { createAdApproval, decideAdApproval, listAdApprovals, reconcileAdApproval } from '../platformAds/approvals.js';
import { listAdLaunches, saveAdLaunch, reconcileAdLaunch } from '../platformAds/launch.js';

export const platformAdsRouter = Router();
const safeRead = (handler: RequestHandler, taskScoped = false): RequestHandler => (req, res, next) => {
  void (async () => {
    if (taskScoped && !await getPlatformAdTask((res.locals as AuthLocals).tenantId, req.params.id)) { res.status(404).json({ error: '未找到该投放任务' }); return; }
    await handler(req, res, next);
  })().catch(() => { if (!res.headersSent) res.status(503).json({ error: '投放数据暂时无法读取，请稍后重试' }); });
};
platformAdsRouter.use(requireAuth);
platformAdsRouter.use(async (req, res, next) => {
  if (req.method === 'GET') { next(); return; }
  if (isBrowserReadToken(req.headers.authorization)) { res.status(403).json({ error: 'agent_browser_read_only' }); return; }
  const { userId, supportAccess } = res.locals as AuthLocals;
  const role = await requestOrganizationRoleStrict(req.headers.authorization, userId);
  if (supportAccess || !role || !['super_admin', 'admin', 'social_operator'].includes(role)) { res.status(403).json({ error: '当前身份无权修改投放计划' }); return; }
  next();
});

platformAdsRouter.post('/tasks/ai-plan', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  try { res.status(201).json({ task: await createAiPlatformAdPlan(tenantId, userId, req.body || {}) }); }
  catch (error) {
    if (error instanceof PlatformAdTaskValidationError) { res.status(400).json({ error: error.message }); return; }
    console.error('[platform-ads:ai-plan]', error);
    res.status(503).json({ error: 'AI 方案生成失败，未创建投放计划，请稍后重试' });
  }
});

platformAdsRouter.post('/tasks/:id/management', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  try {
    const task = await changePlatformAdManagement(tenantId, userId, req.params.id, req.body || {});
    if (!task) { res.status(404).json({ error: '未找到该投放任务' }); return; }
    res.json({ task });
  } catch (error) {
    if (error instanceof PlatformAdTaskValidationError) { res.status(error instanceof PlatformAdTaskConflictError ? 409 : 400).json({ error: error.message }); return; }
    console.error('[platform-ads:management]', error);
    res.status(503).json({ error: '管理方式暂时无法更新，请稍后重试' });
  }
});

platformAdsRouter.get('/tasks/:id/automation', safeRead(async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const [rules, runs] = await Promise.all([
    listAdAutomationRules(tenantId, req.params.id),
    store.list(AD_AUTOMATION_RUNS, { where: { tenant_id: tenantId, taskId: req.params.id }, sort: '-createdAt', perPage: 50 }),
  ]);
  res.json({ rules, runs: runs.items });
}, true));
platformAdsRouter.post('/tasks/:id/automation', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  try { res.json({ rule: await saveAdAutomationRule(tenantId, req.params.id, req.body || {}) }); }
  catch (error) {
    if (error instanceof PlatformAdTaskValidationError) { res.status(error instanceof PlatformAdTaskConflictError ? 409 : 400).json({ error: error.message }); return; }
    res.status(503).json({ error: '自动规则暂时无法保存' });
  }
});

platformAdsRouter.get('/tasks/:id/approvals', safeRead(async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  res.json({ items: await listAdApprovals(tenantId, req.params.id) });
}, true));
platformAdsRouter.get('/tasks/:id/launch', safeRead(async (req, res) => {
  res.json({ items: await listAdLaunches((res.locals as AuthLocals).tenantId, req.params.id) });
}, true));
platformAdsRouter.post('/tasks/:id/launch', async (req, res) => {
  try { res.status(201).json({ launch: await saveAdLaunch((res.locals as AuthLocals).tenantId, req.params.id, req.body || {}) }); }
  catch (error) {
    if (error instanceof PlatformAdTaskValidationError) { res.status(error instanceof PlatformAdTaskConflictError ? 409 : 400).json({ error: error.message }); return; }
    res.status(503).json({ error: '自动启动计划暂时无法保存，请检查配置' });
  }
});
platformAdsRouter.post('/tasks/:id/launch/:launchId/reconcile', async (req, res) => {
  try { res.json({ launch: await reconcileAdLaunch((res.locals as AuthLocals).tenantId, req.params.id, req.params.launchId) }); }
  catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : '平台状态尚未确认' }); }
});
platformAdsRouter.post('/tasks/:id/approvals/:approvalId/reconcile', async (req, res) => {
  try { res.json({ approval: await reconcileAdApproval((res.locals as AuthLocals).tenantId, req.params.id, req.params.approvalId) }); }
  catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : '平台状态尚未确认' }); }
});
platformAdsRouter.post('/tasks/:id/approvals', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  try { res.status(201).json({ approval: await createAdApproval(tenantId, userId, req.params.id, req.body || {}) }); }
  catch (error) {
    if (error instanceof PlatformAdTaskValidationError) { res.status(error instanceof PlatformAdTaskConflictError ? 409 : 400).json({ error: error.message }); return; }
    res.status(503).json({ error: '审批暂时无法创建，请检查动作配置后重试' });
  }
});
platformAdsRouter.post('/tasks/:id/approvals/:approvalId/decision', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  try { res.json({ approval: await decideAdApproval(tenantId, userId, req.params.id, req.params.approvalId, req.body?.decision) }); }
  catch (error) {
    if (error instanceof PlatformAdTaskValidationError) { res.status(400).json({ error: error.message }); return; }
    res.status(503).json({ error: '审批暂时无法处理，请稍后重试' });
  }
});

platformAdsRouter.get('/tasks', safeRead(async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  res.json({ items: await listPlatformAdTasks(tenantId) });
}));

platformAdsRouter.get('/tasks/:id', safeRead(async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const task = await getPlatformAdTask(tenantId, req.params.id);
  if (!task) { res.status(404).json({ error: '未找到该投放任务' }); return; }
  res.json({ task });
}));

platformAdsRouter.post('/tasks', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  try {
    const task = await createPlatformAdTask(tenantId, userId, req.body || {});
    res.status(201).json({ task });
  } catch (error) {
    if (error instanceof PlatformAdTaskValidationError) { res.status(error instanceof PlatformAdTaskConflictError ? 409 : 400).json({ error: error.message }); return; }
    console.error('[platform-ads:create-task]', error);
    res.status(503).json({ error: '投放草稿暂时无法保存，请稍后重试' });
  }
});

platformAdsRouter.patch('/tasks/:id', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  try {
    const task = await updatePlatformAdTask(tenantId, req.params.id, req.body || {});
    if (!task) { res.status(404).json({ error: '未找到该投放任务' }); return; }
    res.json({ task });
  } catch (error) {
    if (error instanceof PlatformAdTaskValidationError) { res.status(error instanceof PlatformAdTaskConflictError ? 409 : 400).json({ error: error.message }); return; }
    console.error('[platform-ads:update-task]', error);
    res.status(503).json({ error: '投放草稿暂时无法更新，请稍后重试' });
  }
});
